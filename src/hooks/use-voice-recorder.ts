'use client';
//
// Records a voice note in the browser (and in the Capacitor web view, which
// asks for the microphone the first time).
//
// MediaRecorder picks the container: WebM/Opus on Chrome and Android, MP4/AAC
// on Safari and iOS. Both are small enough that a few minutes of talking is a
// couple of megabytes, and both are accepted by /api/ai/coach-voice.

import { useCallback, useEffect, useRef, useState } from 'react';

/** Long enough to say what's going on; short enough to stay a voice note. */
export const MAX_VOICE_NOTE_SECONDS = 180;

const PREFERRED_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

export type VoiceRecorderState = 'idle' | 'recording' | 'unsupported';

export interface VoiceRecording {
  blob: Blob;
  mimeType: string;
  seconds: number;
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined;
  }
  return PREFERRED_TYPES.find(type => MediaRecorder.isTypeSupported(type));
}

export function isVoiceRecordingSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

/**
 * `start()` asks for the microphone and begins recording; `stop()` finishes
 * and resolves `onRecorded`; `cancel()` throws the recording away. Recording
 * stops itself at MAX_VOICE_NOTE_SECONDS.
 */
export function useVoiceRecorder(options: {
  onRecorded: (recording: VoiceRecording) => void;
  onError?: (message: string) => void;
}) {
  const [state, setState] = useState<VoiceRecorderState>('idle');
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);
  // Held in a ref so a recording finishing after a re-render still reaches the
  // latest callback rather than the one captured when it started.
  const handlersRef = useRef(options);
  handlersRef.current = options;

  useEffect(() => {
    if (!isVoiceRecordingSupported()) setState('unsupported');
  }, []);

  const release = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  // Never leave the microphone on after the athlete navigates away.
  useEffect(() => () => {
    cancelledRef.current = true;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    release();
  }, [release]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    stop();
  }, [stop]);

  const start = useCallback(async () => {
    if (!isVoiceRecordingSupported()) {
      setState('unsupported');
      handlersRef.current.onError?.("Voice notes aren't supported on this device — type it instead.");
      return;
    }
    if (recorderRef.current) return;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      handlersRef.current.onError?.(
        // In the phone app, an install from before voice notes has no
        // microphone permission to grant at all — only an update fixes that.
        "Microphone access is off. Allow it for HYBRIDX in your phone's settings — if it isn't listed there, update the app first.",
      );
      return;
    }

    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach(track => track.stop());
      handlersRef.current.onError?.("Couldn't start recording on this device — type it instead.");
      return;
    }

    streamRef.current = stream;
    recorderRef.current = recorder;
    chunksRef.current = [];
    cancelledRef.current = false;
    startedAtRef.current = Date.now();
    setSeconds(0);

    recorder.ondataavailable = event => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const elapsed = Math.round((Date.now() - startedAtRef.current) / 1000);
      const type = recorder.mimeType || mimeType || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type });
      release();
      setState('idle');
      setSeconds(0);
      if (cancelledRef.current || blob.size === 0) return;
      handlersRef.current.onRecorded({ blob, mimeType: type, seconds: elapsed });
    };

    recorder.start(1000);
    setState('recording');
    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setSeconds(elapsed);
      if (elapsed >= MAX_VOICE_NOTE_SECONDS) stop();
    }, 250);
  }, [release, stop]);

  return { state, seconds, start, stop, cancel };
}

/** Sends a recording for transcription and returns what was said. */
export async function transcribeRecording(
  recording: VoiceRecording,
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): Promise<string> {
  const extension = recording.mimeType.includes('mp4')
    ? 'm4a'
    : recording.mimeType.includes('ogg')
      ? 'ogg'
      : 'webm';
  const form = new FormData();
  form.append('audio', recording.blob, `voice-note.${extension}`);

  const response = await fetcher('/api/ai/coach-voice', { method: 'POST', body: form });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      [data.error || "Couldn't make out that voice note.", data.detail && `(${data.detail})`]
        .filter(Boolean)
        .join(' '),
    );
  }
  return typeof data.transcript === 'string' ? data.transcript : '';
}
