'use client';

// Leaflet reads `window` when it loads, so the desk page imports this module
// through next/dynamic with SSR off. Do not import it statically.
import 'leaflet/dist/leaflet.css';
import L, { type LatLngBoundsExpression, type LatLngTuple } from 'leaflet';
import { Fragment, useEffect, useMemo } from 'react';
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import type { CandidatePlan, DeskBoard, DeskJobRow } from '../../shared/types/domain';
import { CLUSTER_COORDS, MAP_BOUNDS, SITE_COORDS, TILE_ATTRIBUTION, TILE_URL, clock, techColor } from './geo';
import { buildScheduleView } from './schedule-view';
import { card, label, warn } from './ui';

const URGENT = '#8c2f21';

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
  const c = SITE_COORDS[row.site.postalCode];
  return c ? [c.lat, c.lng] : null;
}

/**
 * Where the day happens. Each technician's route runs from their cluster
 * through their jobs in time order. Lines are straight and for orientation
 * only: every travel time shown comes from the backend's matrix.
 */
export default function MapView({
  board,
  plan,
  unavailableTechId,
  focusTechId,
  onFocusTech,
}: {
  board: DeskBoard;
  plan?: CandidatePlan;
  unavailableTechId?: string;
  focusTechId?: string;
  onFocusTech: (technicianId: string | undefined) => void;
}) {
  const view = useMemo(() => buildScheduleView(board, plan), [board, plan]);
  const techIds = board.technicians.map((t) => t.technician.id);

  // Technicians sharing a cluster keep the same start point; their pills are
  // fanned out in screen pixels so both stay readable at every zoom.
  const bases = useMemo(() => {
    const seen = new Map<string, number>();
    return board.technicians.map(({ technician }) => {
      const cluster = technician.currentCluster ?? '';
      const c = CLUSTER_COORDS[cluster] ?? CLUSTER_COORDS.cbd!;
      const n = seen.get(cluster) ?? 0;
      seen.set(cluster, n + 1);
      return { technician, at: [c.lat, c.lng] as LatLngTuple, fan: n };
    });
  }, [board.technicians]);

  const routes = bases.map(({ technician, at }) => {
    const slots = view.slots.filter((s) => s.technicianId === technician.id);
    const stops = slots.map((s) => ({ slot: s, at: sitePoint(s.row) }));
    const points = [at, ...stops.flatMap((s) => (s.at ? [s.at] : []))];
    // A leg is changed when the plan moved the job it leads into.
    const changedLegs: LatLngTuple[][] = [];
    let prev = at;
    for (const s of stops) {
      if (!s.at) continue;
      if (s.slot.change !== 'unchanged') changedLegs.push([prev, s.at]);
      prev = s.at;
    }
    return { technician, points, changedLegs };
  });

  const focusPoints = routes.flatMap((r) => r.changedLegs.flat());
  const dimmed = (technicianId: string | undefined) => focusTechId !== undefined && focusTechId !== technicianId;

  return (
    <section style={{ ...card, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <div>
          <span style={label}>Singapore · field map</span>
          <p style={{ margin: '4px 0 0', fontSize: 15 }}>
            {plan ? 'Routes as the selected plan would run them' : 'Routes on the committed board'}
          </p>
        </div>
        <span style={{ fontSize: 11, color: '#6b6455' }}>Hover a technician to trace their day</span>
      </div>

      <MapContainer
        bounds={WINDOW}
        maxBounds={LIMIT}
        maxBoundsViscosity={0.8}
        minZoom={11}
        maxZoom={18}
        zoomSnap={0.25}
        scrollWheelZoom={false}
        style={{ width: '100%', aspectRatio: '16 / 10', minHeight: 300, borderRadius: 6, background: '#e9e6de' }}
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

        <FitToChange signature={plan ? `${plan.id}:${focusPoints.length}` : 'board'} points={focusPoints} />

        {routes.map(({ technician, points, changedLegs }) => {
          if (points.length < 2) return null;
          const color = techColor(techIds, technician.id);
          const dim = dimmed(technician.id);
          const hover = {
            mouseover: () => onFocusTech(technician.id),
            mouseout: () => onFocusTech(undefined),
          };
          return (
            <Fragment key={`route-${technician.id}`}>
              <Polyline
                positions={points}
                eventHandlers={hover}
                pathOptions={{
                  color,
                  weight: focusTechId === technician.id ? 5 : 3,
                  opacity: dim ? 0.12 : 0.8,
                  lineJoin: 'round',
                }}
              />
              {changedLegs.map((leg, i) => (
                <Polyline
                  key={i}
                  positions={leg}
                  pathOptions={{
                    color: warn,
                    weight: 5,
                    dashArray: '8 6',
                    opacity: dim ? 0.15 : 1,
                    className: 'desk-ants',
                  }}
                />
              ))}
            </Fragment>
          );
        })}

        {view.slots.map((s) => {
          const at = sitePoint(s.row);
          if (!at) return null;
          const urgent = s.row.job.priority === 'urgent';
          const moved = s.change !== 'unchanged';
          const dim = dimmed(s.technicianId);
          const locked = s.row.job.lockState && s.row.job.lockState !== 'none';
          return (
            <Fragment key={`job-${s.jobId}`}>
              {moved ? (
                <CircleMarker
                  center={at}
                  radius={13}
                  interactive={false}
                  pathOptions={{ color: warn, weight: 3, fill: false, opacity: dim ? 0.25 : 1 }}
                />
              ) : null}
              <CircleMarker
                center={at}
                radius={8}
                pathOptions={{
                  color: '#fff',
                  weight: 2.5,
                  fillColor: urgent ? URGENT : techColor(techIds, s.technicianId),
                  fillOpacity: dim ? 0.25 : 1,
                  opacity: dim ? 0.25 : 1,
                }}
              >
                <Tooltip direction="top" offset={[0, -8]}>
                  <strong>
                    {locked ? '🔒 ' : ''}
                    {s.row.customer.name}
                  </strong>
                  <br />
                  {s.row.site.addressLine1}
                  <br />
                  {clock(s.start)}–{clock(s.end)}
                  {s.travelBeforeMinutes ? ` · ${s.travelBeforeMinutes} min travel (matrix)` : ''}
                </Tooltip>
              </CircleMarker>
              {moved && s.travelBeforeMinutes ? (
                <Marker position={at} icon={tagIcon(`${s.travelBeforeMinutes} min`, warn)} interactive={false} opacity={dim ? 0.25 : 1} />
              ) : null}
            </Fragment>
          );
        })}

        {view.unassigned.map((r) => {
          const at = sitePoint(r);
          if (!at) return null;
          return (
            <Marker key={`open-${r.job.id}`} position={at} icon={openJobIcon(`${r.customer.name} · unassigned`)} zIndexOffset={500}>
              <Tooltip direction="top" offset={[0, -12]}>
                <strong>{r.customer.name}</strong>
                <br />
                {r.site.addressLine1} — unassigned
              </Tooltip>
            </Marker>
          );
        })}

        {bases.map(({ technician, at, fan }) => (
          <Marker
            key={`tech-${technician.id}`}
            position={at}
            icon={techIcon(technician.name, techColor(techIds, technician.id), technician.id === unavailableTechId, fan)}
            opacity={dimmed(technician.id) ? 0.35 : 1}
            zIndexOffset={1000}
            eventHandlers={{
              mouseover: () => onFocusTech(technician.id),
              mouseout: () => onFocusTech(undefined),
            }}
          />
        ))}
      </MapContainer>
    </section>
  );
}

/**
 * Frames the legs a plan changes when one is selected, and the whole window
 * when it is cleared. Runs once per plan, so the coordinator can pan freely.
 */
function FitToChange({ signature, points }: { signature: string; points: LatLngTuple[] }) {
  const map = useMap();
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (points.length === 0) {
      map.flyToBounds(WINDOW, { animate: !reduce, duration: 0.8 });
    } else {
      map.flyToBounds(L.latLngBounds(points).pad(0.35), { animate: !reduce, duration: 0.8, maxZoom: 14 });
    }
    // `points` is derived from the plan, which `signature` already names.
  }, [map, signature]);
  return null;
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function techIcon(name: string, color: string, off: boolean, fan: number): L.DivIcon {
  const w = name.length * 8.5 + 20;
  return L.divIcon({
    className: 'desk-map-tech',
    html: `<span style="background:${off ? '#f3e0dc' : color};color:${off ? URGENT : '#fff'};${
      off ? 'text-decoration:line-through;' : ''
    }">${escape(name)}</span>`,
    iconSize: [w, 24],
    // Later technicians in the same cluster sit down and to the right.
    iconAnchor: [w / 2 - fan * 34, 12 - fan * 22],
  });
}

function tagIcon(text: string, color: string): L.DivIcon {
  return L.divIcon({
    className: 'desk-map-tag',
    html: `<span style="border-color:${color};color:${color}">${escape(text)}</span>`,
    iconSize: [0, 0],
    iconAnchor: [-16, 24],
  });
}

function openJobIcon(text: string): L.DivIcon {
  return L.divIcon({
    className: 'desk-map-open',
    html: `<span class="desk-map-open__pulse"></span><span class="desk-map-open__dot"></span><span class="desk-map-open__label">${escape(
      text,
    )}</span>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}
