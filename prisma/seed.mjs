import { PrismaClient } from "@prisma/client";

const db=new PrismaClient();
async function main() {
  const investors=[
    {name:"Lux Capital",canonicalDomain:"luxcapital.com",rationale:"Initial curated VC universe; verify portfolio membership from the configured portfolio source."},
    {name:"Amplify Partners",canonicalDomain:"amplifypartners.com",rationale:"Initial curated VC universe; verify portfolio membership from the configured portfolio source."}
  ];
  for(const investor of investors) await db.investor.upsert({where:{name:investor.name},update:investor,create:investor});
  const [lux,amplify]=await Promise.all([db.investor.findUniqueOrThrow({where:{name:"Lux Capital"}}),db.investor.findUniqueOrThrow({where:{name:"Amplify Partners"}})]);
  await db.source.upsert({where:{url:"https://www.luxcapital.com/companies"},update:{investorId:lux.id,allowedDomains:["luxcapital.com"]},create:{url:"https://www.luxcapital.com/companies",type:"portfolio",capabilities:["fetch","extract","discover"],rationale:"Initial manually configured portfolio source.",investorId:lux.id,refreshPolicy:"manual-review-first",allowedDomains:["luxcapital.com"]}});
  await db.source.upsert({where:{url:"https://www.amplifypartners.com/"},update:{investorId:amplify.id,allowedDomains:["amplifypartners.com"]},create:{url:"https://www.amplifypartners.com/",type:"portfolio",capabilities:["fetch","extract","discover"],rationale:"Initial manually configured portfolio source.",investorId:amplify.id,refreshPolicy:"manual-review-first",allowedDomains:["amplifypartners.com"]}});
}
main().finally(()=>db.$disconnect());
