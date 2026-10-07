'use client';

// Leaflet reads `window` when it loads, so the desk page imports this module
// through next/dynamic with SSR off. Do not import it statically.
import 'leaflet/dist/leaflet.css';
import L, { type LatLngBoundsExpression, type LatLngTuple } from 'leaflet';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import type { CandidatePlan, DeskBoard, DeskJobRow } from '../../shared/types/domain';
import { CLUSTER_COORDS, MAP_BOUNDS, TILE_ATTRIBUTION, TILE_URL, clock, siteCoords, techColor } from './geo';
import { buildScheduleView } from './schedule-view';
import { urgent as URGENT, warn } from './tokens';

const WINDOW: LatLngBoundsExpression = [
  [MAP_BOUNDS.south, MAP_BOUNDS.west],
  [MAP_BOUNDS.north, MAP_BOUNDS.east],
];

// Panning stops a little past the island; OneMap has no tiles beyond it.
const LIMIT: LatLngBoundsExpression = [
  [MAP_BOUNDS.south - 0.08, MAP_BOUNDS.west - 0.12],
  [MAP_BOUNDS.north + 0.08, MAP_BOUNDS.east + 0.12],
];

function sitePoint(row: DeskJobRow): LatLngTuple | null {
  const c = siteCoords(row.site.postalCode, row.site.estateCluster);
  return c ? [c.lat, c.lng] : null;
}

/** Screen space the desk's floating layers cover, so framing avoids them. */
export interface MapInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Where the day happens, full-bleed. Each technician's route runs from their
 * cluster through their jobs in time order, with stops numbered as in the
 * list. Lines are straight and for orientation only: every travel time shown
 * comes from the backend's matrix.
 */
export default function MapView({
  board,
  plan,
  unavailableTechId,
  focusTechId,
  frameTechId,
  onFocusTech,
  onPinTech,
  insets = { top: 16, right: 16, bottom: 16, left: 16 },
  resetSignal = 0,
}: {
  board: DeskBoard;
  plan?: CandidatePlan;
  unavailableTechId?: string;
  focusTechId?: string;
  /** The technician whose day the map frames: pinned, or hovered in the list. */
  frameTechId?: string;
  onFocusTech: (technicianId: string | undefined) => void;
  onPinTech?: (technicianId: string) => void;
  insets?: MapInsets;
  /** Bump to fly back to the whole island. */
  resetSignal?: number;
}) {
  const view = useMemo(() => buildScheduleView(board, plan), [board, plan]);
  const techIds = board.technicians.map((t) => t.technician.id);

  // Technicians sharing a cluster keep the same start point; their dots are
  // fanned out in screen pixels so both stay clickable at every zoom.
  const bases = useMemo(() => {
    const seen = new Map<string, number>();
    return board.technicians.map(({ technician, loadMinutes }) => {
      const cluster = technician.currentCluster ?? '';
      const c = CLUSTER_COORDS[cluster] ?? CLUSTER_COORDS.cbd!;
      const n = seen.get(cluster) ?? 0;
      seen.set(cluster, n + 1);
      return { technician, loadMinutes, at: [c.lat, c.lng] as LatLngTuple, fan: n };
    });
  }, [board.technicians]);

  const routes = bases.map(({ technician, at }) => {
    const slots = view.slots.filter((s) => s.technicianId === technician.id);
    const stops = slots.map((s, i) => ({ slot: s, n: i + 1, at: sitePoint(s.row) }));
    // Each leg is its own arc. A leg into a job the plan moved is drawn
    // separately, dashed, so the change reads at a glance.
    const legs: Array<{ from: LatLngTuple; to: LatLngTuple; changed: boolean }> = [];
    let prev = at;
    for (const s of stops) {
      if (!s.at) continue;
      legs.push({ from: prev, to: s.at, changed: s.slot.change !== 'unchanged' });
      prev = s.at;
    }
    const changedLegs = legs.filter((l) => l.changed).map((l) => [l.from, l.to]);
    return { technician, stops, legs, changedLegs, points: [at, ...stops.flatMap((s) => (s.at ? [s.at] : []))] };
  });

  const framedRoute = routes.find((r) => r.technician.id === frameTechId);
  const focusPoints = framedRoute ? framedRoute.points : routes.flatMap((r) => r.changedLegs.flat());
  const fitSignature = framedRoute
    ? `tech:${frameTechId}:${plan?.id ?? 'board'}`
    : plan
      ? `${plan.id}:${focusPoints.length}`
      : 'board';
  const dimmed = (technicianId: string | undefined) => focusTechId !== undefined && focusTechId !== technicianId;
  // The job whose tooltip is open; the technician's callout steps aside for it.
  const [hoverJobId, setHoverJobId] = useState<string | undefined>(undefined);

  return (
    <MapContainer
      bounds={WINDOW}
      maxBounds={LIMIT}
      maxBoundsViscosity={0.8}
      minZoom={11}
      maxZoom={18}
      zoomSnap={0.25}
      zoomControl={false}
      style={{ width: '100%', height: '100%' }}
    >
      <TileLayer
        url={TILE_URL}
        attribution={TILE_ATTRIBUTION}
        // OneMap's z12 tiles print a "not to scale" inset over the sea east
        // of Marine Parade; z13 tiles scaled down do not, and look sharper.
        minNativeZoom={13}
        maxNativeZoom={18}
        bounds={LIMIT}
      />

      <FitToChange signature={`${fitSignature}:${resetSignal}`} points={focusPoints} insets={insets} />
      <TrackSize />

      {routes.map(({ technician, legs }) => {
        const color = techColor(techIds, technician.id);
        const dim = dimmed(technician.id);
        const on = focusTechId === technician.id;
        const hover = {
          mouseover: () => onFocusTech(technician.id),
          mouseout: () => onFocusTech(undefined),
          click: () => onPinTech?.(technician.id),
        };
        return (
          <Fragment key={`route-${technician.id}`}>
            {legs.map((leg, i) => {
              const path = arc(leg.from, leg.to);
              return (
                <Fragment key={i}>
                  {/* Dark casing keeps the line readable over the blue roads. */}
                  <Polyline
                    positions={path}
                    interactive={false}
                    pathOptions={{ color: '#09090b', weight: on ? 8 : 5.5, opacity: dim ? 0.05 : 0.55, lineCap: 'round' }}
                  />
                  {leg.changed ? (
                    <Polyline
                      positions={path}
                      pathOptions={{ color: warn, weight: 4, dashArray: '8 7', opacity: dim ? 0.2 : 1, className: 'desk-ants', lineCap: 'round' }}
                    />
                  ) : (
                    <Polyline
                      positions={path}
                      eventHandlers={hover}
                      pathOptions={{ color, weight: on ? 4.5 : 2.5, opacity: dim ? 0.1 : 0.85, lineCap: 'round' }}
                    />
                  )}
                  {on && !dim ? (
                    <Marker
                      position={path[Math.floor(path.length / 2)]!}
                      icon={arrowIcon(bearing(leg.from, leg.to), leg.changed ? warn : color)}
                      interactive={false}
                      zIndexOffset={400}
                    />
                  ) : null}
                </Fragment>
              );
            })}
          </Fragment>
        );
      })}

      {routes.flatMap(({ technician, stops }) =>
        stops.map(({ slot: s, n, at }) => {
          if (!at) return null;
          const moved = s.change !== 'unchanged';
          const dim = dimmed(technician.id);
          const locked = s.row.job.lockState && s.row.job.lockState !== 'none';
          return (
            <Fragment key={`job-${s.jobId}`}>
              <Marker
                position={at}
                icon={pinIcon(String(n), techColor(techIds, technician.id), moved)}
                opacity={dim ? 0.25 : 1}
                zIndexOffset={moved ? 600 : Math.round((1.5 - at[0]) * 100)}
                eventHandlers={{
                  mouseover: () => {
                    onFocusTech(technician.id);
                    setHoverJobId(s.jobId);
                  },
                  mouseout: () => {
                    onFocusTech(undefined);
                    setHoverJobId(undefined);
                  },
                  click: () => onPinTech?.(technician.id),
                }}
              >
                <Tooltip direction="top" offset={[0, -30]}>
                  <strong>
                    {locked ? '🔒 ' : ''}
                    {s.row.customer.name}
                  </strong>
                  <br />
                  {s.row.site.addressLine1}
                  <br />
                  {clock(s.start)}–{clock(s.end)} · {technician.name}
                  {s.travelBeforeMinutes ? ` · ${s.travelBeforeMinutes} min travel` : ''}
                </Tooltip>
              </Marker>
              {moved && s.travelBeforeMinutes ? (
                <Marker position={at} icon={tagIcon(`${s.travelBeforeMinutes} min`, warn)} interactive={false} opacity={dim ? 0.25 : 1} zIndexOffset={700} />
              ) : null}
            </Fragment>
          );
        }),
      )}

      {view.unassigned.map((r) => {
        const at = sitePoint(r);
        if (!at) return null;
        const ws = r.job.windowStart?.slice(11, 16);
        const we = r.job.windowEnd?.slice(11, 16);
        return (
          <Marker key={`open-${r.job.id}`} position={at} icon={openJobIcon()} zIndexOffset={800}>
            <Tooltip direction="top" offset={[0, -30]}>
              <strong>{r.customer.name}</strong>
              <br />
              {r.site.addressLine1}
              <br />
              Needs a technician{ws && we ? ` · window ${ws}–${we}` : ''}
            </Tooltip>
          </Marker>
        );
      })}

      {bases.map(({ technician, loadMinutes, at, fan }) => {
        const jobs = view.slots.filter((s) => s.technicianId === technician.id).length;
        const off = technician.id === unavailableTechId;
        return (
          <Marker
            key={`tech-${technician.id}`}
            position={at}
            icon={techIcon(techColor(techIds, technician.id), off, fan, focusTechId === technician.id)}
            opacity={dimmed(technician.id) ? 0.35 : 1}
            zIndexOffset={1000}
            eventHandlers={{
              mouseover: () => onFocusTech(technician.id),
              mouseout: () => onFocusTech(undefined),
              click: () => onPinTech?.(technician.id),
            }}
          >
            {focusTechId === technician.id && !view.slots.some((s) => s.jobId === hoverJobId && s.technicianId === technician.id) ? (
              <Tooltip permanent direction="right" offset={[14, 0]} className="desk-callout">
                <strong>{technician.name}</strong>
                <br />
                {off ? 'Unavailable today' : `${cap(technician.currentCluster)} · ${jobs} job${jobs === 1 ? '' : 's'} · ${loadMinutes} min booked`}
              </Tooltip>
            ) : null}
          </Marker>
        );
      })}
    </MapContainer>
  );
}

/** The map's pane is sized by the layout, so Leaflet must re-measure when it changes. */
function TrackSize() {
  const map = useMap();
  useEffect(() => {
    // Drop Leaflet's "Leaflet |" prefix; the OneMap credit it sits beside stays.
    map.attributionControl?.setPrefix(false);
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

/**
 * Frames the legs a plan changes, a pinned technician's day, or the whole
 * window, inside the part of the map no panel covers. Runs when what is framed
 * or the free space changes, so the coordinator can otherwise pan freely.
 */
function FitToChange({ signature, points, insets }: { signature: string; points: LatLngTuple[]; insets: MapInsets }) {
  const map = useMap();
  const { top, right, bottom, left } = insets;
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pad = { paddingTopLeft: [left, top] as L.PointTuple, paddingBottomRight: [right, bottom] as L.PointTuple };
    if (points.length === 0) {
      map.flyToBounds(WINDOW, { ...pad, animate: !reduce, duration: 0.8 });
    } else {
      map.flyToBounds(L.latLngBounds(points).pad(0.25), { ...pad, animate: !reduce, duration: 0.8, maxZoom: 14 });
    }
    // `points` is derived from what `signature` names.
  }, [map, signature, top, right, bottom, left]);
  return null;
}

/**
 * A leg as a shallow arc instead of a straight line. Every arc bends to the
 * right of its direction of travel, so a leg that doubles back runs beside the
 * outbound one instead of on top of it. Still for orientation only.
 */
function arc(from: LatLngTuple, to: LatLngTuple, bend = 0.16, steps = 20): LatLngTuple[] {
  const [lat1, lng1] = from;
  const [lat2, lng2] = to;
  const dLat = lat2 - lat1;
  const dLng = lng2 - lng1;
  // Right-hand normal of the travel direction, in (lat, lng).
  const cLat = (lat1 + lat2) / 2 - dLng * bend;
  const cLng = (lng1 + lng2) / 2 + dLat * bend;
  const out: LatLngTuple[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push([u * u * lat1 + 2 * u * t * cLat + t * t * lat2, u * u * lng1 + 2 * u * t * cLng + t * t * lng2]);
  }
  return out;
}

/** Screen angle of travel from one point to the next, in degrees clockwise from east. */
function bearing(from: LatLngTuple, to: LatLngTuple): number {
  return (Math.atan2(-(to[0] - from[0]), to[1] - from[1]) * 180) / Math.PI;
}

function arrowIcon(angle: number, color: string): L.DivIcon {
  return L.divIcon({
    className: 'desk-arrow',
    html: `<svg viewBox="0 0 16 16" width="16" height="16" style="transform:rotate(${angle.toFixed(1)}deg)"><path d="M4 3l7 5-7 5" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function cap(s: string | null | undefined): string {
  if (!s) return '—';
  return s === 'cbd' ? 'CBD' : s.charAt(0).toUpperCase() + s.slice(1);
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const PIN_PATH = 'M12 29C9.6 23.6 1 19.6 1 12a11 11 0 0 1 22 0c0 7.6-8.6 11.6-11 17Z';

function pinIcon(label: string, color: string, moved: boolean): L.DivIcon {
  return L.divIcon({
    className: `desk-pin${moved ? ' desk-pin--moved' : ''}`,
    html: `<svg viewBox="0 0 24 30" width="24" height="30"><path d="${PIN_PATH}" fill="${color}"/></svg><span>${escape(label)}</span>`,
    iconSize: [24, 30],
    iconAnchor: [12, 29],
  });
}

function openJobIcon(): L.DivIcon {
  return L.divIcon({
    className: 'desk-pin desk-pin--open',
    html: `<i class="desk-pin__pulse"></i><svg viewBox="0 0 24 30" width="26" height="32"><path d="${PIN_PATH}" fill="${URGENT}"/></svg><span>!</span>`,
    iconSize: [26, 32],
    iconAnchor: [13, 31],
  });
}

function techIcon(color: string, off: boolean, fan: number, focused: boolean): L.DivIcon {
  return L.divIcon({
    className: `desk-tech${focused ? ' desk-tech--focus' : ''}${off ? ' desk-tech--off' : ''}`,
    html: `<i style="background:${color}"></i><b style="background:${off ? '#52525b' : color}"></b>`,
    iconSize: [34, 34],
    // Later technicians in the same cluster sit down and to the right.
    iconAnchor: [17 - fan * 16, 17 - fan * 12],
  });
}

function tagIcon(text: string, color: string): L.DivIcon {
  return L.divIcon({
    className: 'desk-map-tag',
    html: `<span style="border-color:${color};color:${color}">${escape(text)}</span>`,
    iconSize: [0, 0],
    iconAnchor: [-14, 44],
  });
}
