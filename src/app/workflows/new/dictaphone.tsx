"use client";

import { useEffect, useState } from "react";
import { FaMicrophone, FaStop } from "react-icons/fa";
import SpeechRecognition, { useSpeechRecognition } from "react-speech-recognition";

export function Dictaphone({
  onTranscriptChange,
  shouldReset,
  onClear
}: {
  onTranscriptChange: (text: string) => void;
  shouldReset?: boolean;
  onClear?: () => void
}) {
  const [networkError, setNetworkError] = useState(false);
  const {
    transcript,
    listening,
    resetTranscript,
    browserSupportsSpeechRecognition
  } = useSpeechRecognition();

  useEffect(() => {
    if (shouldReset) {
      resetTranscript();
    }
  }, [shouldReset, resetTranscript]);

  useEffect(() => {
    console.log('Listening:', listening, 'Transcript:', transcript);
    if (transcript) {
      onTranscriptChange(transcript);
    }
  }, [transcript, listening, onTranscriptChange]);

  // Add comprehensive event logging for debugging
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) return;

    const recognition = SpeechRecognition.getRecognition();
    if (!recognition) return;

    const onStart = () => console.log('✅ Speech recognition started');
    const onEnd = () => console.log('⛔ Speech recognition ended');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onError = (event: any) => {
      console.error('❌ Speech recognition error:', event.error, event);
      if (event.error === 'not-allowed') {
        alert('Microphone access denied. Please allow microphone access in browser settings.');
      } else if (event.error === 'no-speech') {
        console.warn('No speech detected. Try speaking closer to the microphone.');
      } else if (event.error === 'aborted') {
        console.warn('Speech recognition aborted.');
      } else if (event.error === 'network') {
        console.error('Network error: Cannot connect to speech recognition servers. This may be due to browser privacy settings blocking Google\'s speech API.');
        setNetworkError(true);
        SpeechRecognition.stopListening();
      }
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onResult = (event: any) => {
      console.log('🎤 Speech result:', event);
    };

    recognition.addEventListener('start', onStart);
    recognition.addEventListener('end', onEnd);
    recognition.addEventListener('error', onError);
    recognition.addEventListener('result', onResult);

    return () => {
      recognition.removeEventListener('start', onStart);
      recognition.removeEventListener('end', onEnd);
      recognition.removeEventListener('error', onError);
      recognition.removeEventListener('result', onResult);
    };
  }, []);

  if (!browserSupportsSpeechRecognition) {
    return null;
  }

  if (networkError) {
    return (
      <div
        title="Speech recognition unavailable: Network error. Try using Chrome or check browser privacy settings."
        className="absolute right-4 top-1/2 -translate-y-1/2 text-[#999] dark:text-[#666] cursor-not-allowed opacity-50"
      >
        <FaMicrophone />
      </div>
    );
  }

  return !listening ? (
    <div
      onClick={async () => {
        console.log('Starting speech recognition...');
        setNetworkError(false);
        try {
          await SpeechRecognition.startListening({
            continuous: true,
            language: 'en-US',
            interimResults: true
          });
          console.log('Speech recognition started successfully');
        } catch (error) {
          console.error('Failed to start speech recognition:', error);
        }
      }}
      className="absolute right-4 top-1/2 -translate-y-1/2 text-[#999] dark:text-[#666] cursor-pointer hover:text-black dark:hover:text-white"
    >
      <FaMicrophone />
    </div>
  ) : (
    <div
      onClick={() => {
        console.log('Stopping speech recognition...');
        SpeechRecognition.stopListening();
        resetTranscript();
        if (onClear) {
          onClear();
        }
      }}
      className="absolute right-4 top-1/2 -translate-y-1/2 text-red-500 dark:text-red-400 cursor-pointer animate-pulse"
    >
      <FaStop />
    </div>
  );
}
