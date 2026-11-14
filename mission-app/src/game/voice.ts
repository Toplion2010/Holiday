// "Hey Holiday" voice assistant: browser speech recognition in, speech synthesis out.
// Recognition needs Chrome or Edge (webkitSpeechRecognition) and microphone permission;
// speech output works in all modern browsers.

interface RecognitionResult { isFinal: boolean; 0: { transcript: string } }
interface RecognitionEvent { resultIndex: number; results: ArrayLike<RecognitionResult> }
interface Recognition {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((e: RecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
  start(): void
  stop(): void
}

const WAKE = /\b(hey|hi|ok|okay)?\s*(holiday|holi day|holy day|holly day|hollyday|holladay|holidays)\b/i
const FOLLOW_UP_MS = 7000

export const voiceSupported = (): boolean =>
  typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)

export class VoiceAssistant {
  private rec: Recognition | null = null
  private listening = false
  private awakeUntil = 0
  muted = false

  constructor(
    private onCommand: (text: string) => string,
    private onHeard: (heard: string, reply: string | null) => void,
    private onState: (listening: boolean, error?: string) => void,
  ) {}

  get active(): boolean {
    return this.listening
  }

  start(): void {
    const W = window as unknown as Record<string, new () => Recognition>
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition
    if (!Ctor) {
      this.onState(false, 'Voice input needs Chrome or Edge.')
      return
    }
    const rec = new Ctor()
    rec.continuous = true
    rec.interimResults = false
    rec.lang = 'en-US'
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) this.handle(r[0].transcript.trim())
      }
    }
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.listening = false
        this.onState(false, 'Microphone permission was denied.')
      }
    }
    // Chrome ends continuous recognition after silence; restart while switched on.
    rec.onend = () => {
      if (this.listening) {
        try {
          rec.start()
        } catch {
          /* already restarting */
        }
      }
    }
    this.rec = rec
    this.listening = true
    try {
      rec.start()
      this.onState(true)
      this.speak('Holiday online. Say hey Holiday, then a command.')
    } catch {
      this.listening = false
      this.onState(false, 'Could not start the microphone.')
    }
  }

  stop(): void {
    this.listening = false
    this.rec?.stop()
    this.rec = null
    this.onState(false)
  }

  toggle(): void {
    if (this.listening) this.stop()
    else this.start()
  }

  /** Text commands go through the same path (typed in the HUD box). */
  handleText(text: string): void {
    const reply = this.onCommand(text)
    this.onHeard(text, reply)
    this.speak(reply)
  }

  private handle(transcript: string): void {
    const m = transcript.match(WAKE)
    let command = ''
    if (m) {
      command = transcript.slice((m.index ?? 0) + m[0].length).replace(/^[\s,.!]+/, '')
      if (!command) {
        this.awakeUntil = performance.now() + FOLLOW_UP_MS
        this.onHeard(transcript, 'Listening…')
        this.speak('Yes?')
        return
      }
    } else if (performance.now() < this.awakeUntil) {
      command = transcript
    } else {
      return
    }
    this.awakeUntil = 0
    const reply = this.onCommand(command)
    this.onHeard(transcript, reply)
    this.speak(reply)
  }

  speak(text: string): void {
    if (this.muted || typeof speechSynthesis === 'undefined') return
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'en-US'
    u.rate = 1.05
    speechSynthesis.speak(u)
  }

  dispose(): void {
    this.stop()
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
  }
}
