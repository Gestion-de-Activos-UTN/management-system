import type { RiskBand } from '@/domain/risk/constants'
import { RISK_BAND_COLOR } from '../risk-labels'

// standby: todavía no hay puntaje · thinking: puntaje preliminar, sin nivel asignado.
type Mood = RiskBand | 'standby' | 'thinking'

export const RISK_ROBOT_MESSAGE: Record<Mood, string> = {
  low: '¡Todo bajo control! Sigamos así.',
  medium: 'Hay cosas por mejorar, pero nada urgente.',
  high: 'Algunos controles me preocupan. ¿Les damos prioridad?',
  critical: '¡Alerta! Hay riesgos importantes sin tratar.',
  thinking: 'Estoy calculando… me faltan datos para dar un nivel.',
  standby: 'En espera: necesito revisiones y equipos identificados.',
}

export function riskRobotMood(score: number | null, band: RiskBand | null): Mood {
  if (score === null) return 'standby'
  return band ?? 'thinking'
}

const EYE_Y = 50
const EYES_X = [46, 74] as const

function Eyes({ mood }: { mood: Mood }) {
  switch (mood) {
    case 'low':
      return (
        <>
          {EYES_X.map(x => (
            <path key={x} d={`M${x - 6} ${EYE_Y + 2} Q${x} ${EYE_Y - 7} ${x + 6} ${EYE_Y + 2}`} />
          ))}
        </>
      )
    case 'high':
      return (
        <>
          <path d="M38 42 L52 39" />
          <path d="M68 39 L82 42" />
          {EYES_X.map(x => (
            <circle key={x} cx={x} cy={EYE_Y + 1} r={4.5} className="robot-led-fill" />
          ))}
        </>
      )
    case 'critical':
      return (
        <>
          {EYES_X.map(x => (
            <g key={x}>
              <circle cx={x} cy={EYE_Y} r={7} />
              <circle cx={x} cy={EYE_Y} r={2.5} className="robot-led-fill" />
            </g>
          ))}
        </>
      )
    case 'standby':
      return (
        <>
          {EYES_X.map(x => (
            <path key={x} d={`M${x - 6} ${EYE_Y} H${x + 6}`} />
          ))}
        </>
      )
    default:
      return (
        <>
          {EYES_X.map(x => (
            <circle key={x} cx={x} cy={EYE_Y} r={5} className="robot-led-fill" />
          ))}
        </>
      )
  }
}

function Mouth({ mood }: { mood: Mood }) {
  switch (mood) {
    case 'low':
      return <path d="M49 61 Q60 70 71 61" />
    case 'medium':
      return <path d="M51 64 Q60 66 69 63" />
    case 'high':
      return <path d="M50 67 Q60 60 70 67" />
    case 'critical':
      return <ellipse cx={60} cy={64} rx={5} ry={4} />
    case 'thinking':
      return (
        <g className="robot-thinking">
          {[52, 60, 68].map(x => (
            <circle key={x} cx={x} cy={64} r={2} className="robot-led-fill" />
          ))}
        </g>
      )
    case 'standby':
      return <path d="M56 64 H64" />
  }
}

/**
 * Mascota del panel general: un robot cuya expresión y color siguen el nivel de riesgo.
 * Decorativa — el puntaje y el nivel siempre se muestran también como texto al lado.
 * Animaciones en app/globals.css (`.risk-robot*`), desactivadas con prefers-reduced-motion.
 */
export function RiskRobot({
  score,
  band,
  size = 120,
}: {
  score: number | null
  band: RiskBand | null
  size?: number
}) {
  const mood = riskRobotMood(score, band)
  const color = band ? RISK_BAND_COLOR[band] : 'gray'
  const led = `var(--mantine-color-${color}-4)`
  return (
    <svg
      viewBox="0 0 120 130"
      width={size}
      height={(size * 130) / 120}
      role="img"
      aria-label={RISK_ROBOT_MESSAGE[mood]}
      className={`risk-robot risk-robot--${mood}`}
      style={{ ['--robot-led' as string]: led, flexShrink: 0 }}
    >
      <g className="risk-robot-body">
        {/* Antena */}
        <line x1={60} y1={10} x2={60} y2={22} className="robot-metal-stroke" strokeWidth={3} />
        <circle cx={60} cy={9} r={5} className="robot-antenna robot-led-fill" />
        {/* Orejas */}
        <rect x={9} y={44} width={11} height={22} rx={4} className="robot-metal" />
        <rect x={100} y={44} width={11} height={22} rx={4} className="robot-metal" />
        {/* Cabeza y visor */}
        <rect x={18} y={22} width={84} height={64} rx={22} className="robot-shell" />
        <rect x={27} y={33} width={66} height={42} rx={14} className="robot-visor" />
        <g
          className="robot-face robot-led-stroke"
          fill="none"
          strokeWidth={4}
          strokeLinecap="round"
        >
          <g className="robot-eyes">
            <Eyes mood={mood} />
          </g>
          <Mouth mood={mood} />
        </g>
        {/* Cuello y torso */}
        <rect x={52} y={86} width={16} height={7} rx={2} className="robot-metal" />
        <rect x={34} y={92} width={52} height={32} rx={12} className="robot-shell" />
        <circle cx={60} cy={108} r={5} className="robot-led-fill robot-core" />
      </g>
    </svg>
  )
}
