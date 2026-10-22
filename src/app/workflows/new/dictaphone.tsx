"use client";

import { useEffect, useRef, useState } from "react";
import { FaMicrophone, FaStop } from "react-icons/fa";

export function Dictaphone({
  onTranscriptChange,
  shouldReset,
  onClear
}: {
  onTranscriptChange: (text: string) => void;
  shouldReset?: boolean;
  onClear?: () => void
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const transcriptRef = useRef("");

  useEffect(() => {
    if (shouldReset) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTranscript("");
      transcriptRef.current = "";
      onTranscriptChange("");
    }

  }, [shouldReset, onTranscriptChange]);

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
            onTranscriptChange(updatedTranscript);
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

      if (onClear) {
        setTranscript("");
        transcriptRef.current = "";
        onTranscriptChange("");
        onClear();
      }
    }
  };

  return !isRecording ? (
    <div
      onClick={startRecording}
      className="absolute right-4 top-1/2 -translate-y-1/2 text-[#999] dark:text-[#666] cursor-pointer hover:text-black dark:hover:text-white"
    >
      <FaMicrophone />
    </div>
  ) : (
    <div
      onClick={stopRecording}
      className="absolute right-4 top-1/2 -translate-y-1/2 text-red-500 dark:text-red-400 cursor-pointer animate-pulse"
    >
      <FaStop />
    </div>
  );
}
