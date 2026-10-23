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
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const transcriptRef = useRef("");
  const finalTranscriptsRef = useRef<string[]>([]);

  useEffect(() => {
    if (shouldReset) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTranscript("");
      transcriptRef.current = "";
      finalTranscriptsRef.current = [];
      onTranscriptChange("");
    }
  }, [shouldReset, onTranscriptChange]);

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
            setTranscript(allText);
            transcriptRef.current = allText;
            onTranscriptChange(allText);
          } else if (msg.type === 'utterance') {
            // Add final utterance to our list
            const finalText = msg.utterance.text;
            if (finalText.trim()) {
              finalTranscriptsRef.current.push(finalText);
              const allText = finalTranscriptsRef.current.join(' ');
              setTranscript(allText);
              transcriptRef.current = allText;
              onTranscriptChange(allText);
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

  const stopRecording = () => {
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

    if (onClear) {
      setTranscript("");
      transcriptRef.current = "";
      finalTranscriptsRef.current = [];
      onTranscriptChange("");
      onClear();
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
