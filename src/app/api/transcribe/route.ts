import { getCurrentUser, unauthorized } from "@/lib/auth";
import OpenAI from "openai";

export const dynamic = "force-dynamic";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Transcribes audio using OpenAI Whisper API.
 * Accepts audio files and returns transcribed text.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File;

    if (!audioFile) {
      return Response.json(
        { error: "No audio file provided" },
        { status: 400 }
      );
    }

    // Check if audio file is too small (likely silence)
    // Typical webm with actual speech is at least 5KB for 3 seconds
    if (audioFile.size < 5000) {
      return Response.json({ text: "" });
    }

    // Transcribe using Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
      language: "en",
      response_format: "verbose_json",
    });

    // Filter out common Whisper hallucinations and check confidence
    const text = transcription.text?.trim() || "";

    // Common hallucinations that Whisper generates from silence
    const hallucinations = [
      "thank you",
      "thanks for watching",
      "bye",
      "bye bye",
      "you",
      ".",
      "",
      "this is a transcription of a user speaking clearly"
    ];

    const lowerText = text.toLowerCase();

    // Check if it's a hallucination
    if (hallucinations.some(h => lowerText.includes(h) && lowerText.length < 50)) {
      return Response.json({ text: "" });
    }

    // If no segments or very low confidence, it's likely silence
    if (!transcription.segments || transcription.segments.length === 0) {
      return Response.json({ text: "" });
    }

    return Response.json({ text: text });
  } catch (error) {
    console.error("Transcription error:", error);
    return Response.json(
      { error: "Failed to transcribe audio" },
      { status: 500 }
    );
  }
}
