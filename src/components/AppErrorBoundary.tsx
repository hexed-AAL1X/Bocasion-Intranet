"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import styles from "./AppErrorBoundary.module.css";

type Props = { children: ReactNode };

type State = { error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[AppErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className={styles.fallback}>
          <div className={styles.card}>
            <h1>Algo salió mal</h1>
            <p>
              La interfaz encontró un error inesperado. Recarga la página; si vuelve a ocurrir, contacta al equipo de desarrollo con la
              hora y la pantalla donde estabas.
            </p>
            <button type="button" className={styles.btn} onClick={() => window.location.reload()}>
              Recargar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
