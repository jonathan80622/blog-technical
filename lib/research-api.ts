/** HTTP contract shared by the Next route and backend acceptance tests. */
import { emitTestTrace } from './test-trace.ts';
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
    const effects: unknown[] = [];
    const respond = (body: unknown, status: number) => {
      emitTestTrace({ handler: 'researchHandler', input, effects, response: { status, body } });
      return Response.json(body, {status});
    };
    try { input = await request.json(); }
    catch { return respond({error: 'Invalid JSON body.'}, 400); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return respond({error: 'Expected an object.'}, 400);
    const {url, label, sourceKind} = input as Record<string, unknown>;
    try {
      if (typeof url !== 'string') throw new RequestError('A source URL is required.');
      let parsed: URL;
      try { parsed = new URL(url); } catch { throw new RequestError('Invalid source URL.'); }
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new RequestError('Use an HTTPS source URL without credentials.');
      if (label !== undefined && (typeof label !== 'string' || label.length > 200)) throw new RequestError('label must be text of at most 200 characters.');
      if (sourceKind !== undefined && !['VC_PORTFOLIO', 'TECHNICAL_BLOG', 'HIRING_POSTING'].includes(sourceKind as string)) throw new RequestError('Invalid source kind.');
      const createInput = {url: parsed.toString(), label: label as string | undefined, sourceKind: sourceKind as string | undefined};
      let created: {run: {id: string}; sourceRun: {id: string}};
      try { created = await deps.create(createInput.url, createInput.label, createInput.sourceKind); effects.push({operation: 'create', input: createInput, output: created}); }
      catch (error) { effects.push({operation: 'create', input: createInput, threw: error instanceof Error ? error.message : String(error)}); throw error; }
      const {run, sourceRun} = created;
      let workflow: {runId: string};
      try { workflow = await deps.dispatch(sourceRun.id); effects.push({operation: 'dispatch', input: {sourceRunId: sourceRun.id}, output: workflow}); }
      catch {
        effects.push({operation: 'dispatch', input: {sourceRunId: sourceRun.id}, threw: true});
        const failureInput = {sourceRunId: sourceRun.id, message: 'Workflow dispatch failed; collection was not confirmed.'};
        try { const output = await deps.failed(failureInput.sourceRunId, failureInput.message); effects.push({operation: 'failed', input: failureInput, output}); }
        catch (error) { effects.push({operation: 'failed', input: failureInput, threw: error instanceof Error ? error.message : String(error)}); }
        return respond({error: 'Workflow dispatch failed.', runId: run.id, sourceRunId: sourceRun.id}, 503);
      }
      try { const output = await deps.attach(sourceRun.id, workflow.runId); effects.push({operation: 'attach', input: {sourceRunId: sourceRun.id, workflowRunId: workflow.runId}, output}); }
      catch {
        // Dispatch succeeded: do not call this a failed collection or start it twice.
        effects.push({operation: 'attach', input: {sourceRunId: sourceRun.id, workflowRunId: workflow.runId}, threw: true});
        return respond({error: 'Workflow started but tracking could not be saved.', runId: run.id, sourceRunId: sourceRun.id, workflowRunId: workflow.runId}, 503);
      }
      return respond({runId: run.id, sourceRunId: sourceRun.id, workflowRunId: workflow.runId, state: 'QUEUED'}, 202);
    } catch (error) {
      return respond({error: error instanceof RequestError ? error.message : 'Research service unavailable.'}, error instanceof RequestError ? 400 : 503);
    }
  };
}
