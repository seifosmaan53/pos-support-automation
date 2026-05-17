import { describe, expect, it } from "vitest";
import { deriveAudioCardState } from "./AudioStatusCard";
import type { AudioState } from "../services/appStore";

function audio(overrides: Partial<AudioState>): AudioState {
  return {
    status: "idle",
    blobUrl: null,
    blobMimeType: null,
    durationMs: 0,
    wavPath: null,
    isPersisted: false,
    errorMessage: null,
    recordingStartedAt: null,
    pausedAt: null,
    totalPausedMs: 0,
    ...overrides,
  };
}

describe("deriveAudioCardState", () => {
  it("returns no-recording when there's nothing in any state", () => {
    const d = deriveAudioCardState({
      audio: audio({}),
      hasTicket: false,
      linkedAudioId: null,
      linkedAudioDeleted: false,
      whisperConfigured: true,
    });
    expect(d.state).toBe("no-recording");
    expect(d.showSaveToTicket).toBe(false);
  });

  it("returns recording-in-progress while recorder is live", () => {
    const d = deriveAudioCardState({
      audio: audio({ status: "recording", recordingStartedAt: Date.now() }),
      hasTicket: false,
      linkedAudioId: null,
      linkedAudioDeleted: false,
      whisperConfigured: true,
    });
    expect(d.state).toBe("recording-in-progress");
  });

  it("flags 'paused' as recording-in-progress with the paused title", () => {
    const d = deriveAudioCardState({
      audio: audio({ status: "paused" }),
      hasTicket: false,
      linkedAudioId: null,
      linkedAudioDeleted: false,
      whisperConfigured: true,
    });
    expect(d.state).toBe("recording-in-progress");
    expect(d.title).toMatch(/paused/i);
  });

  it("returns saved-locally when WAV exists on disk and no ticket yet", () => {
    const d = deriveAudioCardState({
      audio: audio({
        status: "ready",
        isPersisted: true,
        wavPath: "/tmp/rec.wav",
      }),
      hasTicket: false,
      linkedAudioId: null,
      linkedAudioDeleted: false,
      whisperConfigured: true,
    });
    expect(d.state).toBe("saved-locally");
    expect(d.showSaveToTicket).toBe(true);
  });

  it("returns not-attached when ticket is saved but no audioId is linked", () => {
    const d = deriveAudioCardState({
      audio: audio({
        status: "ready",
        isPersisted: true,
        wavPath: "/tmp/rec.wav",
      }),
      hasTicket: true,
      linkedAudioId: null,
      linkedAudioDeleted: false,
      whisperConfigured: true,
    });
    expect(d.state).toBe("not-attached");
    expect(d.showSaveToTicket).toBe(true);
    expect(d.tone).toBe("warning");
  });

  it("returns attached when ticket has a linked audio row", () => {
    const d = deriveAudioCardState({
      audio: audio({}),
      hasTicket: true,
      linkedAudioId: "audio-123",
      linkedAudioDeleted: false,
      whisperConfigured: true,
    });
    expect(d.state).toBe("attached");
    expect(d.tone).toBe("success");
    expect(d.showReTranscribe).toBe(true);
  });

  it("hides re-transcribe when whisper is not configured", () => {
    const d = deriveAudioCardState({
      audio: audio({}),
      hasTicket: true,
      linkedAudioId: "audio-123",
      linkedAudioDeleted: false,
      whisperConfigured: false,
    });
    expect(d.state).toBe("attached");
    expect(d.showReTranscribe).toBe(false);
  });

  it("returns replace-available when a fresh recording sits over an attached row", () => {
    const d = deriveAudioCardState({
      audio: audio({
        status: "ready",
        isPersisted: true,
        wavPath: "/tmp/new.wav",
      }),
      hasTicket: true,
      linkedAudioId: "audio-old",
      linkedAudioDeleted: false,
      whisperConfigured: true,
    });
    expect(d.state).toBe("replace-available");
    expect(d.showReplace).toBe(true);
    expect(d.tone).toBe("warning");
  });

  it("returns audio-deleted when the linked row is marked deleted", () => {
    const d = deriveAudioCardState({
      audio: audio({}),
      hasTicket: true,
      linkedAudioId: "audio-123",
      linkedAudioDeleted: true,
      whisperConfigured: true,
    });
    expect(d.state).toBe("audio-deleted");
  });

  it("returns transcribing while whisper is running", () => {
    const d = deriveAudioCardState({
      audio: audio({ status: "transcribing", isPersisted: true, wavPath: "/x" }),
      hasTicket: true,
      linkedAudioId: "audio-123",
      linkedAudioDeleted: false,
      whisperConfigured: true,
    });
    expect(d.state).toBe("transcribing");
  });

  it("returns error and surfaces the message", () => {
    const d = deriveAudioCardState({
      audio: audio({ status: "error", errorMessage: "Mic permission denied." }),
      hasTicket: false,
      linkedAudioId: null,
      linkedAudioDeleted: false,
      whisperConfigured: true,
    });
    expect(d.state).toBe("error");
    expect(d.detail).toBe("Mic permission denied.");
    expect(d.tone).toBe("danger");
  });
});
