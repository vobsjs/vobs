export type {
  DshClientContext,
  DshClientPlugin,
  DshSlotDeclaration,
  DshSlotEntry,
  DshSlotKind,
  DshSlotRegistration,
  DshSlotsService
} from './types.js'

export {
  DSH_REACT_GLOBAL,
  resetDshReact,
  resolveDshReact,
  useDshReact,
  type DshReact
} from './react.js'

export {
  createVobsSlotHost,
  createVobsPropsSlotHost,
  DSH_ROOT_CLASS,
  DEFAULT_ICON_HOST_STYLE,
  DEFAULT_OVERLAY_HOST_STYLE,
  DEFAULT_PANEL_HOST_STYLE,
  resolveScheme,
  type DshHostStyle,
  type DshPropsSlotHostComponent,
  type DshSlotHostComponent,
  type DshSurfaceOptions
} from './host.js'

export {
  defineDshOverlay,
  defineDshPanel,
  defineDshPlugin,
  type DshOverlayOptions,
  type DshPanelOptions,
  type DshPluginSpec,
  type DshSurfaceRegistrationOptions
} from './plugin.js'
