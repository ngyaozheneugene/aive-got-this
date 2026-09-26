'use client';

import { Component, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

/**
 * Keeps a map failure from taking the desk down. Leaflet owns its DOM, and a
 * dev hot reload that re-runs react-leaflet's effects can throw "Map
 * container is being reused". Scheduling must stay usable whatever the map does.
 */
export class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean; attempt: number }> {
  state = { failed: false, attempt: 0 };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  // The map fills the desk, so try a fresh container a couple of times
  // before asking the coordinator to reload it.
  componentDidCatch() {
    if (this.state.attempt < 2) {
      setTimeout(() => this.setState((s) => ({ failed: false, attempt: s.attempt + 1 })), 250);
    }
  }

  render() {
    if (this.state.failed && this.state.attempt >= 2) {
      return (
        <Card className="m-4 border-dashed">
          <CardHeader>
            <CardTitle>Map didn’t load</CardTitle>
            <CardDescription>The list, the timeline and your options still work. The map is only for orientation.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }))}>
              <RotateCcw />
              Reload map
            </Button>
          </CardContent>
        </Card>
      );
    }
    if (this.state.failed) return null;
    // A fresh key gives Leaflet a brand-new container on retry.
    return (
      <div key={this.state.attempt} className="h-full min-h-0">
        {this.props.children}
      </div>
    );
  }
}
