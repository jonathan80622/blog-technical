export type UnresolvedSourceReason="insufficient_content"|"browser_render_required"|"access_or_challenge";

export class UnresolvedSourceError extends Error {
  readonly reason:UnresolvedSourceReason;
  constructor(reason:UnresolvedSourceReason,message:string){super(message);this.name="UnresolvedSourceError";this.reason=reason;}
}

export const unresolvedSourceReason=(error:unknown):UnresolvedSourceReason|undefined => error instanceof UnresolvedSourceError?error.reason:undefined;
