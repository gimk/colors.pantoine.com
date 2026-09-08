import type { Gamut } from '../color/oklch'
import type { Mode } from '../state/mode'
import { HelpDialog } from './HelpDialog'
import { ModeSwitch } from './ModeSwitch'

type Props = {
  mode: Mode
  onMode: (mode: Mode) => void
  gamut: Gamut
}

/**
 * The masthead, identical in both modes and above whatever toolbar follows it.
 *
 * One bar rather than one per mode: the name of the tool, the switch between
 * its halves, and the help do not change with what you are making, and a
 * header that rearranged itself as you crossed between modes would make the
 * crossing feel like leaving for a different site.
 *
 * Laid out as three grid columns rather than with spacers, so the switch is
 * centred on the *window* and not on whatever is left after the title and the
 * credit have taken their room. It is the one control here that says where you
 * are, so it should not drift as the two sides change width.
 */
export function Masthead({ mode, onMode, gamut }: Props) {
  return (
    <header className="masthead">
      <h1>COLORS // PANTOINE</h1>

      <ModeSwitch mode={mode} onMode={onMode} />

      <span className="masthead__end">
        <span className="masthead__credit">
          Made with dedication by{' '}
          <a
            href="https://www.pantoine.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            Antoine Pouligny
          </a>
        </span>
        <span className="badge badge--solid">OKLCH</span>
        <HelpDialog gamut={gamut} />
      </span>
    </header>
  )
}
