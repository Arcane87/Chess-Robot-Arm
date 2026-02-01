// =========================
// Core domain models
// =========================

interface Study {
  id: string
  name: string
}

interface ModelRefs {
  piecesModelRef: any
  xcornersModelRef: any
}

interface MovesData {
  sans: string[]
  from: number[]
  to: number[]
  targets: number[]
}

interface MovesPair {
  move1: MovesData
  move2: MovesData | null
  moves: MovesData | null
}

type CornersKey = "h1" | "a1" | "a8" | "h8"

interface CornersPayload {
  key: CornersKey
  xy: number[]
}

type CornersDict = { [key in CornersKey]: number[] }

interface Game {
  fen: string
  moves: string
  start: string
  lastMove: string
  greedy: boolean
}

interface User {
  username: string
}

interface RootState {
  game: Game
  corners: CornersDict
  user: User
}

// =========================
// App / UI state
// =========================

type Mode = "record" | "upload" | "analyze" | "play"

// =========================
// Camera / Device handling
// =========================

/**
 * Supported camera device types
 * - webcam   → browser MediaDevices
 * - droidcam → DroidCam / IP-based virtual camera
 */
type DeviceType = "webcam" | "droidcam"

/**
 * Unified camera device descriptor
 * Works for:
 * - navigator.mediaDevices
 * - DroidCam virtual devices
 * - future IP / RTSP sources
 */
interface CameraDevice {
  deviceId: string
  kind: MediaDeviceKind | "virtual"
  label: string
  type: DeviceType
}

// =========================
// React setters
// =========================

type SetBoolean = React.Dispatch<React.SetStateAction<boolean>>
type SetString = React.Dispatch<React.SetStateAction<string>>
type SetStringArray = React.Dispatch<React.SetStateAction<string[]>>
type SetNumber = React.Dispatch<React.SetStateAction<number>>
type SetStudy = React.Dispatch<React.SetStateAction<Study | null>>

// =========================
// Exports
// =========================

export type {
  RootState,
  Study,
  ModelRefs,
  MovesData,
  MovesPair,
  CornersDict,
  CornersKey,
  CornersPayload,
  Game,
  Mode,
  DeviceType,
  CameraDevice,
  SetBoolean,
  SetString,
  SetStringArray,
  SetNumber,
  SetStudy
}
