// Контракт между оболочкой (главный экран + глобус) и режимами: маршруты, прогулка, мемориал и т.д.
//
// Оболочка находит режимы сама: каждый файл `src/features/<имя>/mode.tsx` экспортирует
// `export const mode: ModeDefinition`. Режим общается с глобусом только через GlobeApi,
// поэтому режимы не трогают engine.ts и не зависят друг от друга.

import type { ComponentType, LazyExoticComponent } from 'react';

/** Planetocentric latitude, east longitude 0–360 (как во всём проекте). */
export interface LonLat {
  lon: number;
  lat: number;
}

export interface GlobeLine {
  points: LonLat[];
  /** CSS-цвет, например '#ff5a3c'. */
  color: string;
  /** Толщина в пикселях экрана. */
  width?: number;
  dashed?: boolean;
}

export type MarkerKind = 'rover' | 'memorial' | 'site' | 'poi' | 'walk';

export interface GlobeMarker {
  id: string;
  lon: number;
  lat: number;
  label: string;
  kind?: MarkerKind;
  color?: string;
}

export interface FlyToTarget extends LonLat {
  /**
   * Высота камеры над поверхностью в единицах сцены, где радиус Марса = 1
   * (как `altitudeScene` у MarsGlobeEngine.focus). По умолчанию 0.35.
   */
  altitude?: number;
}

/** Всё, что режим может делать с глобусом. Реализует оболочка поверх MarsGlobeEngine. */
export interface GlobeApi {
  flyTo(target: FlyToTarget, durationMs?: number): Promise<void>;
  /** Слой линий режима; null — убрать слой. layerId уникален в пределах режима. */
  setLines(layerId: string, lines: GlobeLine[] | null): void;
  /** Слой меток режима; клик по метке вызывает onClick(id). null — убрать слой. */
  setMarkers(layerId: string, markers: GlobeMarker[] | null, onClick?: (id: string) => void): void;
  /** Марсоход на маршруте: гладкая кривая и анимация; возвращает точки кривой для линии. */
  setRoverRoute?(points: LonLat[] | null): LonLat[] | null;
  /**
   * Клик по поверхности шара передаётся режиму вместо карточки точки; null — вернуть как было.
   * Снимается сам при выходе из режима. Необязательный: оболочка может его не поддерживать.
   */
  onPick?(handler: ((point: LonLat) => void) | null): void;
}

/** Откуда уходим на шар: точка и высота камеры над ней в последний кадр режима. */
export interface ExitOrigin {
  lon: number;
  lat: number;
  altitudeKm: number;
}

export interface ModeContext {
  globe: GlobeApi;
  /** Параметры режима из адреса: `#walk/gale-boxwork` → { site: 'gale-boxwork' } и т.п. */
  params: Record<string, string>;
  /** Выйти из режима обратно в режим исследования (шар с кнопками). */
  exit(): void;
  /** Выйти с переходом: шар появляется над этой точкой на этой высоте и плавно отлетает. */
  exitFrom(origin: ExitOrigin): void;
  /** Открыть другой режим, например из карточки места — прогулку. */
  openMode(id: string, params?: Record<string, string>): void;
}

export interface ModeDefinition {
  /** Короткий id для адреса: `#<id>` или `#<id>/<param>`. */
  id: string;
  /** Подпись кнопки на шаре. */
  title: string;
  /** Одна строка подсказки под кнопкой. */
  description: string;
  /** Порядок кнопок слева направо. */
  order: number;
  /**
   * true — режим занимает весь экран вместо глобуса (прогулка от первого лица):
   * оболочка ставит рендер глобуса на паузу и показывает Panel поверх всего.
   * false — Panel рисуется боковой панелью поверх глобуса.
   * Функция — по параметрам адреса: прогулка без участка — панель выбора над шаром.
   */
  fullscreen: boolean | ((params: Record<string, string>) => boolean);
  /** Ключ параметра из адреса, если режим его принимает (`walk` → 'site'). */
  paramKey?: string;
  /** Не показывать кнопку в панели режимов (режим открывается только из других режимов). */
  hidden?: boolean;
  Panel: LazyExoticComponent<ComponentType<ModeContext>>;
}

// --- Прогулка от первого лица → HUD -------------------------------------------------------

/** Происхождение значения на экране (docs/TZ_First_Person.md, 6.1). */
export type Provenance = 'data' | 'archive' | 'model' | 'nodata';

/** Мгновенное состояние игрока в локальной сцене. Создаёт режим walk, рисует HUD. */
export interface WalkState {
  siteId: string;
  siteTitle: string;
  lat: number;
  lonEast: number;
  /** Высота поверхности под ногами, м относительно ареоида (из DTM). */
  heightM: number;
  /** Курс, градусы от севера по часовой. */
  headingDeg: number;
  /** Уклон под ногами и на 10 м впереди по курсу, градусы. */
  slopeHereDeg: number;
  slopeAheadDeg: number;
  /** Пройдено по фактическому пути от старта, м. */
  walkedM: number;
  /** Расстояние по прямой до базы (точка старта / лагерь A), м, и азимут на неё. */
  baseDistanceM: number;
  baseBearingDeg: number;
  /** Ближайшая точка маршрута ровера, если есть. */
  nearestTrackPoint?: { sol: number; distanceM: number; mission: string };
  /** Подпись уровня данных: «HiRISE DTM 2 м». */
  dataLevel: string;
  /** Модельное время симуляции (с учётом ускорения), миллисекунды UTC. */
  simTimeMs: number;
  /** Множитель времени: 1, 10, 60. */
  timeScale: number;
  /** Время с начала выхода по модельным часам, с. */
  evaSeconds: number;
  /** Порог непроходимого уклона, градусы. */
  maxSlopeDeg: number;
  /** Чем перемещаемся: ровер (вид с мачты) или пешком (скафандр). */
  vehicle?: 'rover' | 'walk';
}

export function modeIsFullscreen(mode: ModeDefinition | null | undefined, params: Record<string, string>): boolean {
  if (!mode) return false;
  return typeof mode.fullscreen === 'function' ? mode.fullscreen(params) : mode.fullscreen;
}
