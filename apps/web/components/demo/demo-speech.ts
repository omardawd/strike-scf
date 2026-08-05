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

export function stopSpeaking(): void {
  if (supported()) window.speechSynthesis.cancel()
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
export async function speak(text: string): Promise<void> {
  if (!supported()) return
  const clean = speakableText(text)
  if (!clean) return
  await ensureVoicesLoaded()
  if (cachedVoice === undefined) cachedVoice = resolveVoice()
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(clean)
  if (cachedVoice) utterance.voice = cachedVoice
  utterance.rate = 1.0
  utterance.pitch = 1.0
  window.speechSynthesis.speak(utterance)
}
