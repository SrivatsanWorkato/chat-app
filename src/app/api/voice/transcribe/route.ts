import { transcribeAudio } from "@/lib/openrouter";
import { getSession } from "@/lib/session";

// OpenRouter's AssemblyAI endpoint accepts only wav input; the browser encodes 16 kHz mono PCM WAV.

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const mediaType = request.headers.get("content-type")?.split(";")[0].trim();
  if (mediaType !== "audio/wav") return Response.json({ error: "Unsupported audio format" }, { status: 400 });
  const audio = await request.arrayBuffer();
  if (audio.byteLength === 0 || audio.byteLength > 20_000_000) return Response.json({ error: "Invalid audio recording" }, { status: 400 });
  try {
    return Response.json({ text: await transcribeAudio(audio, "wav") });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unable to transcribe audio";
    console.error("[voice] transcription failed", { error: detail });
    return Response.json({ error: detail }, { status: detail.includes("not configured") ? 503 : 502 });
  }
}
