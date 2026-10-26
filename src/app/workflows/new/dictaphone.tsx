"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FaMicrophone, FaStop } from "react-icons/fa";

export function Dictaphone({
  promptInputRef,
  shouldReset,
  onStopRecording
}: {
  promptInputRef?: React.RefObject<HTMLTextAreaElement | null>;
  shouldReset?: boolean;
  onStopRecording?: (stopFn: () => void) => void;
}) {
  const [isRecording, setIsRecording] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const transcriptRef = useRef("");
  const finalTranscriptsRef = useRef<string[]>([]);

  useEffect(() => {
    if (shouldReset) {
      transcriptRef.current = "";
      finalTranscriptsRef.current = [];
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

  const updateTextarea = useCallback((text: string) => {
    // Find the textarea in the AI_Prompt component and update it
    const textarea = document.querySelector('textarea[placeholder*="automate"]') as HTMLTextAreaElement;
    if (textarea) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(textarea, text);
        const event = new Event('input', { bubbles: true });
        textarea.dispatchEvent(event);
      }
    }
  }, []);

  const stopRecording = useCallback(() => {
    // Send end-of-stream signal
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send('');
      wsRef.current.close();
    }
    wsRef.current = null;

    // Stop audio processing
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Stop the stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    setIsRecording(false);
  }, []);

  useEffect(() => {
    if (onStopRecording) {
      onStopRecording(stopRecording);
    }
  }, [onStopRecording, stopRecording]);

  const startRecording = async () => {
    try {
      // Get API configuration
      const configResponse = await fetch('/api/transcribe-config');
      if (!configResponse.ok) {
        throw new Error('Failed to get API configuration');
      }
      const { apiKey } = await configResponse.json();

      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
          channelCount: 1
        }
      });
      streamRef.current = stream;

      // Create WebSocket connection directly to Modulate
      const modulateUrl =
        `wss://platform.modulate.ai/api/velma-2-stt-streaming-english-v2` +
        `?api_key=${apiKey}` +
        `&audio_format=s16le` +
        `&sample_rate=16000` +
        `&num_channels=1` +
        `&endpointing=true`;

      const ws = new WebSocket(modulateUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');

        // Set up audio processing
        const audioContext = new AudioContext({ sampleRate: 16000 });
        audioContextRef.current = audioContext;

        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
          if (ws.readyState === WebSocket.OPEN) {
            const inputData = e.inputBuffer.getChannelData(0);
            // Convert float32 to int16
            const int16Data = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
              const s = Math.max(-1, Math.min(1, inputData[i]));
              int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            ws.send(int16Data.buffer);
          }
        };

        source.connect(processor);
        processor.connect(audioContext.destination);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === 'partial_utterance') {
            // Update display with partial + all finals
            const partial = msg.partial_utterance.text;
            const allText = [...finalTranscriptsRef.current, partial].join(' ');
            transcriptRef.current = allText;
            updateTextarea(allText);
          } else if (msg.type === 'utterance') {
            // Add final utterance to our list
            const finalText = msg.utterance.text;
            if (finalText.trim()) {
              finalTranscriptsRef.current.push(finalText);
              const allText = finalTranscriptsRef.current.join(' ');
              transcriptRef.current = allText;
              updateTextarea(allText);
            }
          } else if (msg.type === 'done') {
            console.log('Transcription complete');
          } else if (msg.type === 'error') {
            console.error('Transcription error:', msg.error);
          }
        } catch (error) {
          console.error('Error parsing message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      ws.onclose = () => {
        console.log('WebSocket closed');
      };

      setIsRecording(true);

    } catch (error) {
      console.error('Error accessing microphone:', error);
      alert('Could not access microphone. Please check permissions.');
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
