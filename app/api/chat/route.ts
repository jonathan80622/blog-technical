import { answer } from "@/lib/openai";
import { retrieve } from "@/lib/research";
import { chatHandler } from "@/lib/chat-api";

export const runtime="nodejs"; export const maxDuration=60;
export const POST=chatHandler({retrieve,answer});
