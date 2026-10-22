"use client";

import { useEffect, useRef, useState } from "react";
import { FaMicrophone, FaStop } from "react-icons/fa";

export function Dictaphone({
  promptInputRef,
  shouldReset
}: {
  promptInputRef?: React.RefObject<HTMLTextAreaElement>;
  shouldReset?: boolean;
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const transcriptRef = useRef("");

  useEffect(() => {
    if (shouldReset) {
      setTranscript("");
      transcriptRef.current = "";
      // Clear the textarea
      const textarea = document.querySelector('textarea[placeholder*="automate"]') as HTMLTextAreaElement;
      if (textarea) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(textarea, "");
          const event = new Event('input', { bubbles: true });
          textarea.dispatchEvent(event);
        }
      }
    }
  }, [shouldReset]);

  useEffect(() => {
    if (transcript) {
      // Find the textarea in the AI_Prompt component and update it
      const textarea = document.querySelector('textarea[placeholder*="automate"]') as HTMLTextAreaElement;
      if (textarea) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(textarea, transcript);
          const event = new Event('input', { bubbles: true });
          textarea.dispatchEvent(event);
        }
      }
    }
  }, [transcript]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm',
      });

      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });

        // Send to Whisper API for transcription
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm');

        try {
          const response = await fetch('/api/transcribe', {
            method: 'POST',
            body: formData,
          });

          if (response.ok) {
            const data = await response.json();
            const newText = data.text;

            // Append to existing transcript using ref to avoid stale closure
            const updatedTranscript = transcriptRef.current
              ? `${transcriptRef.current} ${newText}`
              : newText;

            transcriptRef.current = updatedTranscript;
            setTranscript(updatedTranscript);
          } else {
            console.error('Transcription failed:', await response.text());
          }
        } catch (error) {
          console.error('Error sending audio for transcription:', error);
        }

        // Clean up
        audioChunksRef.current = [];
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);

      // Auto-send audio chunks every 3 seconds for real-time transcription
      const interval = setInterval(() => {
        if (mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
          // Restart recording for continuous capture
          setTimeout(() => {
            // Check if still recording via ref instead of stale closure
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
              audioChunksRef.current = [];
              mediaRecorder.start();
            }
          }, 100);
        }
      }, 3000);

      // Store interval ID for cleanup
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mediaRecorder as any).intervalId = interval;

    } catch (error) {
      console.error('Error accessing microphone:', error);
      alert('Could not access microphone. Please check permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      // Clear the interval
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const intervalId = (mediaRecorderRef.current as any).intervalId;
      if (intervalId) {
        clearInterval(intervalId);
      }

      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  return !isRecording ? (
    <button
      type="button"
      onClick={startRecording}
      className="flex size-8 items-center justify-center rounded-full text-black/60 hover:bg-black/5 hover:text-black dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white transition-[background-color,color] duration-150"
      aria-label="Start voice input"
    >
      <FaMicrophone className="size-4" />
    </button>
  ) : (
    <button
      type="button"
      onClick={stopRecording}
      className="flex size-8 items-center justify-center rounded-full text-red-500 dark:text-red-400 animate-pulse"
      aria-label="Stop voice input"
    >
      <FaStop className="size-4" />
    </button>
  );
}
