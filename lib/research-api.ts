/** HTTP contract shared by the Next route and backend acceptance tests. */
export class RequestError extends Error {}
type Dependencies = {
  create: (url: string, label?: string, kind?: string) => Promise<{run: {id: string}; sourceRun: {id: string}}>;
  dispatch: (id: string) => Promise<{runId: string}>;
  attach: (id: string, workflowId: string) => Promise<unknown>;
  failed: (id: string, message: string) => Promise<unknown>;
};
export function researchHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    let input: unknown;
    try { input = await request.json(); }
    catch { return Response.json({error: 'Invalid JSON body.'}, {status: 400}); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return Response.json({error: 'Expected an object.'}, {status: 400});
    const {url, label, sourceKind} = input as Record<string, unknown>;
    try {
      if (typeof url !== 'string') throw new RequestError('A source URL is required.');
      let parsed: URL;
      try { parsed = new URL(url); } catch { throw new RequestError('Invalid source URL.'); }
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new RequestError('Use an HTTPS source URL without credentials.');
      if (label !== undefined && (typeof label !== 'string' || label.length > 200)) throw new RequestError('label must be text of at most 200 characters.');
      if (sourceKind !== undefined && !['VC_PORTFOLIO', 'TECHNICAL_BLOG', 'HIRING_POSTING'].includes(sourceKind as string)) throw new RequestError('Invalid source kind.');
      const {run, sourceRun} = await deps.create(parsed.toString(), label as string | undefined, sourceKind as string | undefined);
      let workflow: {runId: string};
      try { workflow = await deps.dispatch(sourceRun.id); }
      catch {
        await deps.failed(sourceRun.id, 'Workflow dispatch failed; collection was not confirmed.');
        return Response.json({error: 'Workflow dispatch failed.', runId: run.id, sourceRunId: sourceRun.id}, {status: 503});
      }
      try { await deps.attach(sourceRun.id, workflow.runId); }
      catch {
        // Dispatch succeeded: do not call this a failed collection or start it twice.
        return Response.json({error: 'Workflow started but tracking could not be saved.', runId: run.id, sourceRunId: sourceRun.id, workflowRunId: workflow.runId}, {status: 503});
      }
      return Response.json({runId: run.id, sourceRunId: sourceRun.id, workflowRunId: workflow.runId, state: 'QUEUED'}, {status: 202});
    } catch (error) {
      return Response.json({error: error instanceof RequestError ? error.message : 'Research service unavailable.'}, {status: error instanceof RequestError ? 400 : 503});
    }
  };
}
