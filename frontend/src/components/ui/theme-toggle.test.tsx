import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryProvider } from "@/app/providers";
import { ThemeToggle } from "./theme-toggle";

function TestWrapper() {
  return (
    <QueryProvider>
      <ThemeToggle />
    </QueryProvider>
  );
}

describe("ThemeToggle", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    window.localStorage.removeItem("naxis-theme");
    // Mock matchMedia for jsdom
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: query.includes("dark"),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  });

  it("toggles theme between dark and light", async () => {
    render(<TestWrapper />);

    const button = screen.getByRole("button");

    // Default resolved theme is dark before mount, then system/dark after
    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    });

    fireEvent.click(button);

    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
      expect(window.localStorage.getItem("naxis-theme")).toBe("light");
    });

    fireEvent.click(button);

    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
      expect(window.localStorage.getItem("naxis-theme")).toBe("dark");
    });
  });
});
