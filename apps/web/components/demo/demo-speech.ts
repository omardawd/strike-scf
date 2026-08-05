'use client'

// Free, zero-setup narration via the browser's built-in Web Speech API —
// no account, no generated files, no per-run cost. Unlike pre-recorded
// audio, it also handles Scene 7's dynamic captions (excerpts of Strike
// AI's real live reply), which can never be pre-recorded since the text
// itself changes every run. DemoNarrator's `audioSrc` prop still takes
// priority when a real recorded clip exists for a beat; this is what plays
// everywhere else.

let cachedVoice: SpeechSynthesisVoice | null | undefined // undefined = not yet resolved this session

const PREFERRED_VOICE_NAMES = [
  'Samantha', 'Google US English', 'Ava', 'Zoe', 'Karen', 'Alex', 'Daniel',
]

function resolveVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices()
  if (voices.length === 0) return null
  for (const name of PREFERRED_VOICE_NAMES) {
    const match = voices.find(v => v.name === name)
    if (match) return match
  }
  return voices.find(v => v.lang === 'en-US') ?? voices.find(v => v.lang?.startsWith('en')) ?? voices[0] ?? null
}

let voicesReadyPromise: Promise<void> | null = null
// Voices load asynchronously in most browsers — an immediate getVoices()
// call right after page load often returns an empty array. Waits for the
// 'voiceschanged' event, with a short fallback timeout for browsers that
// never fire it when voices were already cached.
function ensureVoicesLoaded(): Promise<void> {
  if (window.speechSynthesis.getVoices().length > 0) return Promise.resolve()
  if (voicesReadyPromise) return voicesReadyPromise
  voicesReadyPromise = new Promise(resolve => {
    const handler = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', handler)
      resolve()
    }
    window.speechSynthesis.addEventListener('voiceschanged', handler)
    setTimeout(resolve, 500)
  })
  return voicesReadyPromise
}

function supported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

let currentAudio: HTMLAudioElement | null = null

export function stopSpeaking(): void {
  if (supported()) window.speechSynthesis.cancel()
  if (currentAudio) {
    currentAudio.pause()
    currentAudio = null
  }
}

// Plays a real recorded clip (public/audio/demo/*.mp3) and resolves `true`
// once it actually finishes — same "await the real thing, not just the
// call" fix as speak() below, for the same reason. Resolves `false` on any
// failure (404, decode error, blocked autoplay) so the caller can fall back
// to speak() instead of the beat going silent.
function playRecordedAudio(url: string): Promise<boolean> {
  return new Promise(resolve => {
    const audio = new Audio(url)
    currentAudio = audio
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      if (currentAudio === audio) currentAudio = null
      resolve(ok)
    }
    audio.addEventListener('ended', () => finish(true))
    audio.addEventListener('error', () => finish(false))
    audio.play().catch(() => finish(false))
    // Every recorded clip here is under 15s — this is only a backstop in
    // case 'ended' never fires for some reason, not a real pacing limit.
    setTimeout(() => finish(true), 30000)
  })
}

// The single entry point every beat should call: plays the real recorded
// clip for `audioId` if one exists (public/audio/demo/{audioId}.mp3),
// falling back to live Web Speech if it's missing or fails to load. This is
// what lets fixed lines sound like a real narrator while Scene 6's dynamic
// captions (excerpts of Strike AI's actual live reply, different every run —
// see DemoAgentActivityFeed.tsx) keep working exactly as before, since they
// have no `audioId` and go straight to speak().
export async function narrate(text: string, audioId?: string): Promise<void> {
  if (audioId) {
    const played = await playRecordedAudio(`/audio/demo/${audioId}.mp3`)
    if (played) return
  }
  await speak(text)
}

// Strips the same directive syntax renderAssistantContent parses out
// visually ([[STRIKE_BLOCK:...]], [LISTING_CARD:...]) plus basic markdown
// emphasis, so dynamic Scene 7 excerpts don't get read out literally
// ("asterisk asterisk bold asterisk asterisk").
function speakableText(text: string): string {
  return text
    .replace(/\[\[STRIKE_BLOCK:[\s\S]*?\]\]/g, '')
    .replace(/\[LISTING_CARD:[^\]]+\]/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/[_#`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Cancels whatever is currently speaking (beats never talk over each
// other) and speaks `text` with the best available voice. Safe to call
// before a user gesture — some browsers queue it silently rather than
// throwing, and the audio-gate's own click satisfies the gesture
// requirement for every beat that follows.
//
// Resolves once speech actually FINISHES (utterance 'end'/'error'), not the
// instant `.speak()` is called — this used to resolve immediately, which is
// exactly why beats were audibly cutting themselves off: the caller's own
// visual hold timer ran on a fixed word-count estimate, completely
// decoupled from how long the browser's TTS engine actually took to read
// the line, so the scene routinely advanced (cancelling this utterance)
// mid-sentence. Callers now combine this with their hold timer via
// `Promise.all`, so a beat never advances before its narration is done. A
// safety timeout still caps the wait in case 'end' never fires (a real
// quirk in some browsers/voices), so a beat can never hang forever.
export function speak(text: string): Promise<void> {
  if (!supported()) return Promise.resolve()
  const clean = speakableText(text)
  if (!clean) return Promise.resolve()
  return ensureVoicesLoaded().then(() => new Promise<void>(resolve => {
    if (cachedVoice === undefined) cachedVoice = resolveVoice()
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(clean)
    if (cachedVoice) utterance.voice = cachedVoice
    utterance.rate = 1.0
    utterance.pitch = 1.0

    let settled = false
    let safety: ReturnType<typeof setTimeout>
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(safety)
      resolve()
    }
    utterance.onend = finish
    utterance.onerror = finish
    // ~150ms/word at a natural reading pace, generous floor/ceiling either
    // side — this only ever matters when 'end' fails to fire at all.
    const safetyMs = Math.min(20000, Math.max(3000, clean.split(' ').length * 420))
    safety = setTimeout(finish, safetyMs)

    window.speechSynthesis.speak(utterance)
  }))
}
