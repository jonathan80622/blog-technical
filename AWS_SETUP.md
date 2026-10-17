# AWS setup — CLI-only, incremental, single-owner

This application is single-owner. Do not type sh. Run one command at a time in your normal terminal. Do not run the next command until the current command's expected output matches.

Every command below includes its effect:

- READ asks AWS for information; creates nothing and cannot charge.
- WRITE changes AWS state; it is marked clearly before the command.

Use us-east-1 literally in each command. There are no exported shell variables, hidden substitutions, or bulk scripts.

## 0. Confirm exactly which AWS account the CLI will affect

READ

~~~sh
aws sts get-caller-identity --output table
~~~

Expected: a table containing a 12-digit Account, an Arn, and a UserId. This confirms the active credentials; it does not create or charge for an application resource.

Stop if the account number or ARN is not yours. We use this rather than aws configure list because it proves the credentials work against AWS, not merely that local profile fields exist.

## 1. Discover whether the account has a usable default VPC

READ

~~~sh
aws ec2 describe-vpcs --region us-east-1 --filters Name=isDefault,Values=true --query 'Vpcs[].[VpcId,CidrBlock,IsDefault]' --output table
~~~

Expected: one row such as vpc-..., a CIDR such as 172.31.0.0/16, and True.

Why: the development renderer uses existing public subnets. It does not create a VPC, NAT Gateway, load balancer, or ECS service. A missing row means stop and send the output; creating networking is a separate decision.

Copy the displayed vpc ID into the next command as plain text.

## 2. List public-capable subnets in that VPC

READ — replace only vpc-PASTE_THE_VALUE_FROM_STEP_1 with the exact ID you just saw.

~~~sh
aws ec2 describe-subnets --region us-east-1 --filters Name=vpc-id,Values=vpc-PASTE_THE_VALUE_FROM_STEP_1 --query 'Subnets[].[SubnetId,AvailabilityZone,MapPublicIpOnLaunch,CidrBlock]' --output table
~~~

Expected: two or more rows. Choose two different Availability Zones with MapPublicIpOnLaunch equal to True.

Why: Fargate needs subnets to place a task. True lets this short-lived, no-ingress task reach public source sites without an always-billed NAT Gateway. We use describe-subnets, not a subnet name, because names do not prove routing behavior.

If every row says False, stop. Do not create or modify a subnet from this guide.

Do not inspect route tables manually at this stage. The previous route-table command was removed because it was needlessly fragile and is not a prerequisite for this deployment.

## 3. Create the private artifact bucket

Pick a bucket name yourself before running this. It must be globally unique, lowercase, and contain only letters, numbers, and hyphens. Example format: vc-intelligence-dev-snapshots-yourname-2026.

WRITE — creates one empty S3 bucket. This does not create a crawler or upload data.

~~~sh
aws s3api create-bucket --region us-east-1 --bucket TYPE_YOUR_EXACT_BUCKET_NAME_HERE
~~~

Expected: JSON containing Location with your bucket path. If AWS says BucketAlreadyExists, choose a different name. If it says BucketAlreadyOwnedByYou, do not retry; inspect that bucket instead.

Then enable the two required protections one at a time:

WRITE

~~~sh
aws s3api put-public-access-block --region us-east-1 --bucket TYPE_YOUR_EXACT_BUCKET_NAME_HERE --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
~~~

Expected: no output and exit status 0. AWS CLI writes often succeed silently; that is why the following read check is mandatory.

READ

~~~sh
aws s3api get-public-access-block --region us-east-1 --bucket TYPE_YOUR_EXACT_BUCKET_NAME_HERE --output json
~~~

Expected: all four values are true.

WRITE

~~~sh
aws s3api put-bucket-versioning --region us-east-1 --bucket TYPE_YOUR_EXACT_BUCKET_NAME_HERE --versioning-configuration Status=Enabled
~~~

READ

~~~sh
aws s3api get-bucket-versioning --region us-east-1 --bucket TYPE_YOUR_EXACT_BUCKET_NAME_HERE --output json
~~~

Expected: Status is Enabled.

## 4. Create the image repository, but do not build or push yet

WRITE

~~~sh
aws ecr create-repository --region us-east-1 --repository-name vc-intelligence-renderer --image-tag-mutability IMMUTABLE --image-scanning-configuration scanOnPush=true --output json
~~~

Expected: JSON where repositoryUri ends in /vc-intelligence-renderer and imageTagMutability is IMMUTABLE.

Why: ECR stores the renderer image. Immutable tags prevent a later push from silently changing what a known tag means. This command creates a registry record only; it does not run Fargate or incur renderer compute.

READ

~~~sh
aws ecr describe-repositories --region us-east-1 --repository-names vc-intelligence-renderer --query 'repositories[0].[repositoryUri,imageTagMutability,imageScanningConfiguration.scanOnPush]' --output table
~~~

Expected: one row with repository URI, IMMUTABLE, and True.

## 5. Validate the infrastructure file before creating anything

READ

First prove the local file you are about to send contains the current parameter name:

READ — reads the local file only; AWS is not contacted.

~~~sh
rg -n 'DatabaseSecretArn|ControlPlaneBaseUrl' /Users/jonathan/Codeland/blog-technical/infra/fargate-renderer.yaml
~~~

Expected: two lines containing `ControlPlaneBaseUrl` and **no** line containing `DatabaseSecretArn`. If `DatabaseSecretArn` appears, stop: you are validating an older checkout.

READ — the absolute path removes any ambiguity about the terminal's current directory.

~~~sh
aws cloudformation validate-template --region us-east-1 --template-body file:///Users/jonathan/Codeland/blog-technical/infra/fargate-renderer.yaml --output json
~~~

Expected: JSON listing the six parameters ImageUri, VpcId, PublicSubnetA, PublicSubnetB, ControlPlaneBaseUrl, and SnapshotBucketName.

Why: this makes CloudFormation parse the local file but does not create a stack, IAM role, API Gateway, ECS cluster, or Fargate task. We use it before deploy so template errors are caught without charges.

## 6. Satisfy the Vercel-side prerequisite

This is not an optional future task. The renderer's control plane is the deployed Vercel application: it owns the Prisma Postgres connection and signs render commands. AWS must not receive that database credential.

READ — run from this repository. It lists variable names only, not their values.

~~~sh
npx vercel@latest env ls
~~~

Expected: `DATABASE_URL` appears for the intended Vercel environment. If it does not, the Prisma Postgres integration has not been connected to this project. Do not deploy the renderer yet: it would start but could not redeem a render command.

WRITE — pulls the Production database URL into a separate local file so the migration tool can connect. The database shown above is configured for Production and Preview, not Development. This command does not overwrite `.env.local`.

~~~sh
npx vercel@latest env pull .env.production.local --environment=production
~~~

Expected: confirmation that Production environment variables were written. The value must never be pasted into a shell command, ticket, or chat.

WRITE — applies this repository's already-committed Prisma migrations to Prisma Postgres.

~~~sh
npx dotenv-cli@latest -e .env.production.local -- pnpm exec prisma migrate deploy
~~~

Expected: `No pending migrations to apply` or a list ending in `All migrations have been successfully applied`.

WRITE — deploys the Vercel application that exposes the renderer command and callback endpoints.

~~~sh
npx vercel@latest --prod
~~~

Expected: a production `https://...vercel.app` URL. Copy that URL exactly, without its trailing slash, into the CloudFormation command in step 9.

## 7. Build and push the renderer image

The next commands ask AWS for the repository URI it created in step 4. They do not require an account number, an environment variable, or any manually replaced hostname.

WRITE — logs Docker into this one private ECR registry. It changes Docker's local credential store; it does not run a task.

~~~sh
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin "$(aws ecr describe-repositories --region us-east-1 --repository-names vc-intelligence-renderer --query 'repositories[0].repositoryUri' --output text | cut -d/ -f1)"
~~~

Expected: `Login Succeeded`.

WRITE — builds the local renderer image. It can take several minutes because Chromium is installed inside the image; it does not contact your database or start Fargate.

~~~sh
docker build --pull --tag vc-intelligence-renderer:2026-10-17 ./renderer
~~~

Expected: a final `Successfully tagged vc-intelligence-renderer:2026-10-17` line. Do not continue if Docker reports a failed build.

WRITE — attaches the exact ECR name to that local image.

~~~sh
docker tag vc-intelligence-renderer:2026-10-17 "$(aws ecr describe-repositories --region us-east-1 --repository-names vc-intelligence-renderer --query 'repositories[0].repositoryUri' --output text):2026-10-17"
~~~

Expected: no output and exit code zero.

WRITE — pushes that immutable tag to ECR.

~~~sh
docker push "$(aws ecr describe-repositories --region us-east-1 --repository-names vc-intelligence-renderer --query 'repositories[0].repositoryUri' --output text):2026-10-17"
~~~

Expected: a final `digest: sha256:...` line. Copy the full digest, including `sha256:`.

READ — independently verifies the pushed image and returns its digest.

~~~sh
aws ecr describe-images --region us-east-1 --repository-name vc-intelligence-renderer --image-ids imageTag=2026-10-17 --query 'imageDetails[0].[imageDigest,imagePushedAt]' --output table
~~~

Expected: one row. The digest must match the `docker push` result.

## 8. Deploy the actual AWS resources

This is the command that creates the ECS cluster, IAM roles, API Gateway endpoint, CloudWatch log group, security group, and task definition. It does **not** run a Fargate task; tasks run only after Vercel invokes the API Gateway endpoint.

WRITE — replace each all-caps value with the output from the indicated earlier step. Keep every option and quote exactly as shown.

~~~sh
aws cloudformation deploy --region us-east-1 --stack-name vc-intelligence-renderer --template-file infra/fargate-renderer.yaml --capabilities CAPABILITY_IAM --parameter-overrides ImageUri="$(aws ecr describe-repositories --region us-east-1 --repository-names vc-intelligence-renderer --query 'repositories[0].repositoryUri' --output text)@PASTE_STEP_7_FULL_DIGEST" VpcId="PASTE_STEP_1_VPC_ID" PublicSubnetA="PASTE_FIRST_STEP_2_SUBNET_ID" PublicSubnetB="PASTE_SECOND_STEP_2_SUBNET_ID" ControlPlaneBaseUrl="PASTE_STEP_6_VERCEL_URL" SnapshotBucketName="PASTE_STEP_3_BUCKET_NAME"
~~~

Expected: `Successfully created/updated stack - vc-intelligence-renderer`. If it fails, do not rerun it blindly; the error names the resource CloudFormation could not create.

## 9. Verify that CloudFormation actually created the resources

READ

~~~sh
aws cloudformation describe-stacks --region us-east-1 --stack-name vc-intelligence-renderer --query 'Stacks[0].[StackStatus,Outputs]' --output json
~~~

Expected: `CREATE_COMPLETE` or `UPDATE_COMPLETE`, plus the `RendererApiUrl` output. Anything ending in `ROLLBACK` means deployment did not complete.

READ

~~~sh
aws cloudformation list-stack-resources --region us-east-1 --stack-name vc-intelligence-renderer --query 'StackResourceSummaries[].[ResourceType,ResourceStatus]' --output table
~~~

Expected: rows for `AWS::ECS::Cluster`, `AWS::ECS::TaskDefinition`, `AWS::ApiGateway::RestApi`, two IAM roles, `AWS::EC2::SecurityGroup`, and `AWS::Logs::LogGroup`; every status is `CREATE_COMPLETE` or `UPDATE_COMPLETE`.

## What success never looks like

- An empty terminal by itself is not proof. Check echo $?; zero means the local AWS CLI command exited successfully, then run the paired get or describe read check.
- A prompt containing %n, %m, or %1~ means you started the wrong shell with sh; run exit before doing anything else.
- A command containing a placeholder is not ready to execute. Replace it with an actual value from the immediately previous read command, or stop.
