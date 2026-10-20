"use client";

import { useEffect, useState } from "react";
import { FaMicrophone, FaStop } from "react-icons/fa";
import SpeechRecognition, { useSpeechRecognition } from "react-speech-recognition";

export function Dictaphone({
  promptInputRef,
  shouldReset
}: {
  promptInputRef?: React.RefObject<HTMLTextAreaElement>;
  shouldReset?: boolean;
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
      // Find the textarea in the AI_Prompt component
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
  }, [transcript, listening]);

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
      <button
        type="button"
        disabled
        title="Speech recognition unavailable: Network error. Try using Chrome or check browser privacy settings."
        className="flex size-8 items-center justify-center rounded-full text-black/30 cursor-not-allowed opacity-50 dark:text-white/30"
      >
        <FaMicrophone className="size-4" />
      </button>
    );
  }

  return !listening ? (
    <button
      type="button"
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
      className="flex size-8 items-center justify-center rounded-full text-black/60 hover:bg-black/5 hover:text-black dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white transition-[background-color,color] duration-150"
      aria-label="Start voice input"
    >
      <FaMicrophone className="size-4" />
    </button>
  ) : (
    <button
      type="button"
      onClick={() => {
        console.log('Stopping speech recognition...');
        SpeechRecognition.stopListening();
        resetTranscript();
      }}
      className="flex size-8 items-center justify-center rounded-full text-red-500 dark:text-red-400 animate-pulse"
      aria-label="Stop voice input"
    >
      <FaStop className="size-4" />
    </button>
  );
}
