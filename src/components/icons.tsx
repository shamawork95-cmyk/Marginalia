/**
 * The app's icon set, in one place.
 *
 * Every glyph is Phosphor, exported under the name the codebase already used for it. The
 * indirection earns its keep three ways: the whole set can be swapped again by editing one file,
 * nothing else in the app has to know which library is behind a name, and the two places where a
 * single Lucide icon has no exact Phosphor twin are decided here rather than argued over in
 * twenty components.
 *
 * Sizing stays with the caller. Phosphor renders at `1em` by default, so the `w-4 h-4` classes
 * the components already pass keep working untouched — CSS beats the SVG's own attributes.
 *
 * Weights are Phosphor's real advantage over a single-weight set: a selected tool can thicken
 * rather than only change colour. `regular` is the default here; pass `weight="bold"` or
 * `weight="duotone"` where a state needs to read at a glance.
 */

export type { Icon, IconProps, IconWeight } from '@phosphor-icons/react';

export {
  // ── Navigation and chrome ──
  House as Home,
  MagnifyingGlass as Search,
  Gear as Settings,
  List as Menu,
  DotsThreeVertical as MoreVertical,
  DotsThree as MoreHorizontal,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  ArrowSquareOut as ExternalLink,
  CaretUp as ChevronUp,
  CaretDown as ChevronDown,
  CaretLeft as ChevronLeft,
  CaretRight as ChevronRight,
  X,
  Check,
  CheckCircle as CheckCircle2,
  Plus,
  PlusCircle,
  Minus,

  // ── Library and documents ──
  BookOpen,
  BookBookmark as BookMarked,
  Books,
  FileText,
  Files as FileStack,
  FilePlus as FilePlus2,
  FileX as FileWarning,
  FolderOpen,
  HardDrives as HardDrive,
  UploadSimple as Upload,
  DownloadSimple as Download,
  CloudArrowDown as DownloadCloud,
  Trash as Trash2,
  Copy,
  ClockCounterClockwise as History,
  Quotes as Quote,
  LinkSimple as Link2,
  LinkSimpleBreak as Unlink,
  BoundingBox as AreaSelect,
  Clock,
  SquaresFour as LayoutGrid,
  ListBullets as List,
  FunnelSimple as Filter,
  ArrowsDownUp as ArrowUpDown,

  // ── Annotation tools ──
  // `Cursor` over `CursorClick`: this is the idle select tool, not an act of clicking.
  Cursor as MousePointer2,
  Highlighter,
  TextUnderline as Underline,
  TextStrikethrough as Strikethrough,
  Tag,
  PencilSimpleLine as PenLine,
  PencilSimple as Pencil,
  PencilSimple as Edit3,
  EyeSlash as EyeOff,
  Square,
  Circle,
  BracketsCurly as Braces,
  TextT as Type,
  Eraser,
  Note as StickyNote,
  ArrowUUpLeft as Undo2,
  ArrowUUpRight as Redo2,
  ArrowCounterClockwise as RotateCcw,
  ArrowsClockwise as RefreshCw,

  // ── Viewer controls ──
  MagnifyingGlassPlus as ZoomIn,
  MagnifyingGlassMinus as ZoomOut,
  CornersOut as Maximize2,
  CornersIn as Minimize2,
  FrameCorners as FitPage,
  // Phosphor has no left/right panel pair, so the sidebar glyph carries all four. Which side it
  // belongs to is already obvious from where the button sits.
  SidebarSimple as PanelLeftOpen,
  SidebarSimple as PanelLeftClose,
  SidebarSimple as PanelRightOpen,
  SidebarSimple as PanelRightClose,
  SquareHalf as PanelTop,
  SquareHalfBottom as PanelBottom,

  // ── Status and meaning ──
  Sparkle as Sparkles,
  CircleNotch as Loader2,
  WarningCircle as AlertCircle,
  Warning as AlertTriangle,
  Info,
  Globe,
  Compass,
  Lightbulb,
  Palette,
  Drop as Droplet,
  Scales as Scale,
  Sliders,
  ChatText as MessageSquare,
  Lightning as Zap,
  LockSimple as Lock,
  LockSimpleOpen as Unlock,

  // ── 2.7.0: feedback, poetry, motifs, excerpt board, class packs ──
  ChatCircleText as Feedback,
  Feather,
  Path as MotifPath,
  Kanban as Board,
  Student
} from '@phosphor-icons/react';
