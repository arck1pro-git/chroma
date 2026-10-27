// Os ícones do projeto: Font Awesome Free, estilo Solid (pedido dele em
// 2026-10-27, no lugar do lucide-react).
//
// UM ARQUIVO SÓ, com os NOMES que o projeto já usava (Plus, Trash2, Settings…)
// apontando para o desenho do Font Awesome: as telas só trocaram de onde
// importam, e trocar um ícone no sistema inteiro é mudar uma linha aqui. Ícone
// novo entra aqui primeiro — as telas não importam o pacote direto.
//
// O <svg> é desenhado aqui, a partir do desenho do pacote
// (@fortawesome/free-solid-svg-icons), sem o @fortawesome/react-fontawesome:
// aquele injeta CSS próprio fora das camadas do Tailwind, e o `height: 1em`
// dele venceria o `size-4` de cada tela. Assim o tamanho continua sendo o da
// classe, como era, e a cor é a do texto (fill="currentColor"). Sem classe de
// tamanho, 24px, como o lucide.
//
// RESPIRO: o desenho do Solid é cheio e ocupa a caixa inteira; o do lucide era
// traço fino com folga nas bordas. O viewBox ganha uma margem em volta para o
// ícone ter o mesmo peso ao lado do texto sem mexer nas classes de tamanho das
// telas. Ícone mais largo que alto (usuários, conversas) cabe pela largura.
//
// Licença dos desenhos: CC BY 4.0 — Font Awesome Free, https://fontawesome.com.
import type { JSX, SVGProps } from "react";
import {
  type IconDefinition,
  faAddressBook,
  faAddressCard,
  faAlignLeft,
  faAnglesLeft,
  faArrowDown,
  faArrowLeft,
  faArrowPointer,
  faArrowRight,
  faArrowRightArrowLeft,
  faArrowTrendDown,
  faArrowTrendUp,
  faArrowUp,
  faArrowUpRightFromSquare,
  faArrowsRotate,
  faAt,
  faBars,
  faBell,
  faBold,
  faBookOpen,
  faBoxesStacked,
  faBriefcase,
  faBuilding,
  faBullhorn,
  faCalendar,
  faCalendarCheck,
  faCalendarDay,
  faCalendarDays,
  faCalendarXmark,
  faCamera,
  faChartColumn,
  faChartSimple,
  faCheck,
  faCheckDouble,
  faChevronDown,
  faChevronLeft,
  faChevronRight,
  faChevronUp,
  faCircle,
  faCircleCheck,
  faCircleExclamation,
  faCircleNodes,
  faCircleNotch,
  faCirclePause,
  faCirclePlus,
  faCircleQuestion,
  faCircleXmark,
  faClapperboard,
  faClipboardList,
  faClock,
  faClockRotateLeft,
  faClone,
  faCloudArrowUp,
  faCode,
  faCodeBranch,
  faComment,
  faCommentMedical,
  faCommentSlash,
  faComments,
  faCopy,
  faCubes,
  faDesktop,
  faDiagramProject,
  faDownload,
  faEllipsis,
  faEnvelope,
  faEnvelopeOpenText,
  faEye,
  faEyeSlash,
  faFileLines,
  faFilm,
  faFilter,
  faFlag,
  faFlask,
  faFloppyDisk,
  faFont,
  faGaugeHigh,
  faGear,
  faGlobe,
  faGripVertical,
  faHand,
  faHandshake,
  faHashtag,
  faHourglassHalf,
  faImage,
  faInbox,
  faItalic,
  faKey,
  faLayerGroup,
  faLifeRing,
  faLink,
  faList,
  faListCheck,
  faListUl,
  faLocationDot,
  faLock,
  faMagnifyingGlass,
  faMagnifyingGlassMinus,
  faMessage,
  faMicrophone,
  faMinus,
  faMobileScreen,
  faMoon,
  faMusic,
  faNewspaper,
  faNoteSticky,
  faPaperPlane,
  faPaperclip,
  faPause,
  faPen,
  faPenToSquare,
  faPhone,
  faPhoneVolume,
  faPlay,
  faPlug,
  faPlus,
  faQrcode,
  faRectangleList,
  faRepeat,
  faReply,
  faRightFromBracket,
  faRightToBracket,
  faRobot,
  faRotateLeft,
  faRoute,
  faRss,
  faSackDollar,
  faShieldHalved,
  faShuffle,
  faSitemap,
  faSliders,
  faSort,
  faSquare,
  faStopwatch,
  faStrikethrough,
  faSun,
  faTableCellsLarge,
  faTableColumns,
  faTag,
  faThumbsDown,
  faToggleOff,
  faToggleOn,
  faTrashCan,
  faTriangleExclamation,
  faTrophy,
  faUpload,
  faUser,
  faUserGear,
  faUserGroup,
  faUserMinus,
  faUserPen,
  faUserPlus,
  faUsers,
  faVideo,
  faWallet,
  faWandMagicSparkles,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";

export type PropsDoIcone = SVGProps<SVGSVGElement>;

/** Um ícone do projeto, como as telas recebem em props (`Icone: TipoIcone`). */
export type TipoIcone = (props: PropsDoIcone) => JSX.Element;

const RESPIRO = 0.09;

function icone(definicao: IconDefinition, nome: string): TipoIcone {
  const [largura, altura, , , desenho] = definicao.icon;
  const folga = Math.round(altura * RESPIRO);
  const viewBox = `${-folga} ${-folga} ${largura + 2 * folga} ${altura + 2 * folga}`;
  const caminhos = Array.isArray(desenho) ? desenho : [desenho];
  function Icone(props: PropsDoIcone) {
    // Decorativo por padrão, como no lucide — a não ser que venha com nome.
    const decorativo = !props["aria-label"] && !props["aria-labelledby"] && !props.role;
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={24}
        height={24}
        viewBox={viewBox}
        fill="currentColor"
        focusable="false"
        aria-hidden={decorativo || undefined}
        {...props}
      >
        {caminhos.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </svg>
    );
  }
  Icone.displayName = nome;
  return Icone;
}

export const AlertCircle = icone(faCircleExclamation, "AlertCircle");
export const AlertTriangle = icone(faTriangleExclamation, "AlertTriangle");
export const AlignLeft = icone(faAlignLeft, "AlignLeft");
export const ArrowDown = icone(faArrowDown, "ArrowDown");
export const ArrowDownToLine = icone(faDownload, "ArrowDownToLine");
export const ArrowLeft = icone(faArrowLeft, "ArrowLeft");
export const ArrowRight = icone(faArrowRight, "ArrowRight");
export const ArrowRightLeft = icone(faArrowRightArrowLeft, "ArrowRightLeft");
export const ArrowUp = icone(faArrowUp, "ArrowUp");
export const ArrowUpRight = icone(faArrowUpRightFromSquare, "ArrowUpRight");
export const AtSign = icone(faAt, "AtSign");
export const BadgeCheck = icone(faCircleCheck, "BadgeCheck");
export const BadgeDollarSign = icone(faSackDollar, "BadgeDollarSign");
export const BarChart3 = icone(faChartColumn, "BarChart3");
export const Bell = icone(faBell, "Bell");
export const BellRing = icone(faBell, "BellRing");
export const Blocks = icone(faCubes, "Blocks");
export const Bold = icone(faBold, "Bold");
export const BookOpen = icone(faBookOpen, "BookOpen");
export const Bot = icone(faRobot, "Bot");
export const Boxes = icone(faBoxesStacked, "Boxes");
export const Braces = icone(faCode, "Braces");
export const Briefcase = icone(faBriefcase, "Briefcase");
export const Building2 = icone(faBuilding, "Building2");
export const Calendar = icone(faCalendar, "Calendar");
export const CalendarCheck2 = icone(faCalendarCheck, "CalendarCheck2");
export const CalendarClock = icone(faCalendarDay, "CalendarClock");
export const CalendarDays = icone(faCalendarDays, "CalendarDays");
export const CalendarOff = icone(faCalendarXmark, "CalendarOff");
export const CalendarX2 = icone(faCalendarXmark, "CalendarX2");
export const Camera = icone(faCamera, "Camera");
export const ChartNoAxesColumn = icone(faChartSimple, "ChartNoAxesColumn");
export const Check = icone(faCheck, "Check");
export const CheckCheck = icone(faCheckDouble, "CheckCheck");
export const CheckCircle2 = icone(faCircleCheck, "CheckCircle2");
export const ChevronDown = icone(faChevronDown, "ChevronDown");
export const ChevronLeft = icone(faChevronLeft, "ChevronLeft");
export const ChevronRight = icone(faChevronRight, "ChevronRight");
export const ChevronUp = icone(faChevronUp, "ChevronUp");
export const ChevronsUpDown = icone(faSort, "ChevronsUpDown");
export const Circle = icone(faCircle, "Circle");
export const CircleCheck = icone(faCircleCheck, "CircleCheck");
export const CirclePlus = icone(faCirclePlus, "CirclePlus");
export const CircleX = icone(faCircleXmark, "CircleX");
export const Clapperboard = icone(faClapperboard, "Clapperboard");
export const ClipboardList = icone(faClipboardList, "ClipboardList");
export const Clock = icone(faClock, "Clock");
export const Clock3 = icone(faClock, "Clock3");
export const CloudUpload = icone(faCloudArrowUp, "CloudUpload");
export const Code2 = icone(faCode, "Code2");
export const Columns3 = icone(faTableColumns, "Columns3");
export const Contact = icone(faAddressCard, "Contact");
export const Copy = icone(faCopy, "Copy");
export const CopyPlus = icone(faClone, "CopyPlus");
export const Download = icone(faDownload, "Download");
export const ExternalLink = icone(faArrowUpRightFromSquare, "ExternalLink");
export const Eye = icone(faEye, "Eye");
export const EyeOff = icone(faEyeSlash, "EyeOff");
export const FileText = icone(faFileLines, "FileText");
export const Film = icone(faFilm, "Film");
export const Flag = icone(faFlag, "Flag");
export const FlaskConical = icone(faFlask, "FlaskConical");
export const Funnel = icone(faFilter, "Funnel");
export const GitBranch = icone(faCodeBranch, "GitBranch");
export const Globe = icone(faGlobe, "Globe");
export const Grid2x2 = icone(faTableCellsLarge, "Grid2x2");
export const GripVertical = icone(faGripVertical, "GripVertical");
export const Hand = icone(faHand, "Hand");
export const Handshake = icone(faHandshake, "Handshake");
export const Hash = icone(faHashtag, "Hash");
export const HelpCircle = icone(faCircleQuestion, "HelpCircle");
export const History = icone(faClockRotateLeft, "History");
export const Hourglass = icone(faHourglassHalf, "Hourglass");
export const Image = icone(faImage, "Image");
export const ImageIcon = icone(faImage, "ImageIcon");
export const Inbox = icone(faInbox, "Inbox");
export const Italic = icone(faItalic, "Italic");
export const KeyRound = icone(faKey, "KeyRound");
export const Layers = icone(faLayerGroup, "Layers");
export const LayoutDashboard = icone(faGaugeHigh, "LayoutDashboard");
export const LayoutTemplate = icone(faRectangleList, "LayoutTemplate");
export const LifeBuoy = icone(faLifeRing, "LifeBuoy");
export const Link2 = icone(faLink, "Link2");
export const List = icone(faList, "List");
export const ListChecks = icone(faListCheck, "ListChecks");
export const ListPlus = icone(faListUl, "ListPlus");
export const ListTree = icone(faSitemap, "ListTree");
export const Loader2 = icone(faCircleNotch, "Loader2");
export const LoaderCircle = icone(faCircleNotch, "LoaderCircle");
export const Lock = icone(faLock, "Lock");
export const LogIn = icone(faRightToBracket, "LogIn");
export const LogOut = icone(faRightFromBracket, "LogOut");
export const Mail = icone(faEnvelope, "Mail");
export const MailPlus = icone(faEnvelopeOpenText, "MailPlus");
export const MapPin = icone(faLocationDot, "MapPin");
export const Megaphone = icone(faBullhorn, "Megaphone");
export const MessageCircle = icone(faComment, "MessageCircle");
export const MessageCircleOff = icone(faCommentSlash, "MessageCircleOff");
export const MessageCircleReply = icone(faReply, "MessageCircleReply");
export const MessageSquarePlus = icone(faCommentMedical, "MessageSquarePlus");
export const MessageSquareText = icone(faMessage, "MessageSquareText");
export const MessagesSquare = icone(faComments, "MessagesSquare");
export const Mic = icone(faMicrophone, "Mic");
export const Minus = icone(faMinus, "Minus");
export const Monitor = icone(faDesktop, "Monitor");
export const Moon = icone(faMoon, "Moon");
export const MoreHorizontal = icone(faEllipsis, "MoreHorizontal");
export const MousePointerClick = icone(faArrowPointer, "MousePointerClick");
export const Music = icone(faMusic, "Music");
export const Newspaper = icone(faNewspaper, "Newspaper");
export const PanelLeft = icone(faBars, "PanelLeft");
export const PanelLeftClose = icone(faAnglesLeft, "PanelLeftClose");
export const PanelRightOpen = icone(faTableColumns, "PanelRightOpen");
export const Paperclip = icone(faPaperclip, "Paperclip");
export const Pause = icone(faPause, "Pause");
export const PauseCircle = icone(faCirclePause, "PauseCircle");
export const Pencil = icone(faPen, "Pencil");
export const PencilLine = icone(faPenToSquare, "PencilLine");
export const Phone = icone(faPhone, "Phone");
export const PhoneCall = icone(faPhoneVolume, "PhoneCall");
export const Play = icone(faPlay, "Play");
export const PlugZap = icone(faPlug, "PlugZap");
export const Plus = icone(faPlus, "Plus");
export const QrCode = icone(faQrcode, "QrCode");
export const RefreshCw = icone(faArrowsRotate, "RefreshCw");
export const Repeat = icone(faRepeat, "Repeat");
export const Reply = icone(faReply, "Reply");
export const RotateCcw = icone(faRotateLeft, "RotateCcw");
export const Route = icone(faRoute, "Route");
export const Rss = icone(faRss, "Rss");
export const Save = icone(faFloppyDisk, "Save");
export const Search = icone(faMagnifyingGlass, "Search");
export const SearchX = icone(faMagnifyingGlassMinus, "SearchX");
export const Send = icone(faPaperPlane, "Send");
export const SendHorizonal = icone(faPaperPlane, "SendHorizonal");
export const Settings = icone(faGear, "Settings");
export const Settings2 = icone(faSliders, "Settings2");
export const ShieldCheck = icone(faShieldHalved, "ShieldCheck");
export const Shuffle = icone(faShuffle, "Shuffle");
export const SlidersHorizontal = icone(faSliders, "SlidersHorizontal");
export const Smartphone = icone(faMobileScreen, "Smartphone");
export const Sparkles = icone(faWandMagicSparkles, "Sparkles");
export const Square = icone(faSquare, "Square");
export const SquarePen = icone(faPenToSquare, "SquarePen");
export const StickyNote = icone(faNoteSticky, "StickyNote");
export const Strikethrough = icone(faStrikethrough, "Strikethrough");
export const Sun = icone(faSun, "Sun");
export const Tag = icone(faTag, "Tag");
export const ThumbsDown = icone(faThumbsDown, "ThumbsDown");
export const Timer = icone(faStopwatch, "Timer");
export const ToggleLeft = icone(faToggleOff, "ToggleLeft");
export const ToggleRight = icone(faToggleOn, "ToggleRight");
export const Trash2 = icone(faTrashCan, "Trash2");
export const TrendingDown = icone(faArrowTrendDown, "TrendingDown");
export const TrendingUp = icone(faArrowTrendUp, "TrendingUp");
export const TriangleAlert = icone(faTriangleExclamation, "TriangleAlert");
export const Trophy = icone(faTrophy, "Trophy");
export const Type = icone(faFont, "Type");
export const Upload = icone(faUpload, "Upload");
export const User = icone(faUser, "User");
export const UserCog = icone(faUserGear, "UserCog");
export const UserMinus = icone(faUserMinus, "UserMinus");
export const UserPen = icone(faUserPen, "UserPen");
export const UserPlus = icone(faUserPlus, "UserPlus");
export const UserRound = icone(faUser, "UserRound");
export const UserRoundPlus = icone(faUserPlus, "UserRoundPlus");
export const UserSearch = icone(faAddressBook, "UserSearch");
export const Users = icone(faUsers, "Users");
export const UsersRound = icone(faUserGroup, "UsersRound");
export const Video = icone(faVideo, "Video");
export const Wallet = icone(faWallet, "Wallet");
export const Webhook = icone(faCircleNodes, "Webhook");
export const Workflow = icone(faDiagramProject, "Workflow");
export const X = icone(faXmark, "X");
export const XCircle = icone(faCircleXmark, "XCircle");
