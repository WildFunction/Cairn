export {
  DEFAULT_LOCALE, detectLocale, format, isLocale, LOCALES, messagesFor, parseLocale,
  type Locale, type Messages,
} from './i18n';
export { errorText } from './i18n/errorText';
export { GearMark } from './settings/icons';
export { SettingsProvider, useT, useUi, type UiSettings } from './settings/SettingsProvider';
export {
  DEFAULT_PREFS, parseStored as parseStoredPrefs, TEXT_SCALE, TEXT_SIZES, THEMES, withPref,
  type Prefs, type TextSize, type ThemeChoice,
} from './settings/prefs';
export {
  SettingsPanel, SETTINGS_TABS, type SettingsTab,
} from './settings/SettingsPanel';
export {
  type ModelStatus, type NarrationLanguage, type ProviderInfo, type ProviderModelInfo,
  type ProviderProfile, type ShellPrefs, type ShellSettings, type VoiceOption,
  type WereadAccount, type WereadAccountState, type WereadLoginFailure,
} from './settings/shell';
export { Link, LinkProvider, type OpenLink } from './Link';
export { SlideView, type SlideChrome } from './slides/SlideView';
export { Icon } from './slides/Icon';
/** Dev-only: every layout at its worst, for looking at. See Gauntlet.tsx. */
export { Gauntlet } from './slides/Gauntlet';
export { PlayMark, PauseMark, FastMark, ChevronMark, TrashMark } from './panes/icons';
export { StagePane } from './panes/StagePane';
export { DeckPane } from './panes/DeckPane';
export { CompanionPane } from './panes/CompanionPane';
export { useTransport, RATES, type Transport } from './panes/useTransport';
export { useSplit, type Split } from './panes/useSplit';
export { useResume, type Resume } from './panes/useResume';
export { useAutoHide, IDLE_MS, LEAVE_GRACE_MS, type AutoHide } from './panes/useAutoHide';
export {
  EMPTY_RESUME, closeBook, forgetBook, openBook, placeIn, remember, shouldWrite, startAt,
  parseStored as parseStoredResume,
  type Place, type ResumeStore,
} from './panes/resume';
export { Splitter } from './panes/Splitter';
export { PanelToggle, type PanelControl } from './panes/PanelToggle';
export { BookMenu } from './panes/BookMenu';
export {
  applyDrag, columnWidth, toggle, parseStored,
  LEFT_LIMITS, RIGHT_LIMITS, DEFAULT_LEFT, DEFAULT_RIGHT, RAIL,
  type SplitLimits, type SplitState,
} from './panes/split';
import './app.css';
