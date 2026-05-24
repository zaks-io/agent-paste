import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToastProvider } from "../src/components/ui/ToastProvider";
import { errorToast, useToast } from "../src/components/ui/toast-context";

function PushButton() {
  const { push } = useToast();
  return (
    <button
      type="button"
      onClick={() =>
        push(errorToast("Couldn't load keys", { code: "forbidden", message: "Access denied.", requestId: "req_123" }))
      }
    >
      trigger
    </button>
  );
}

describe("errorToast", () => {
  it("maps an api error envelope to an error toast input", () => {
    const input = errorToast("Title", { code: "rate_limited", message: "Slow down.", requestId: "req_9" });
    expect(input).toEqual({
      tone: "error",
      title: "Title",
      message: "Slow down.",
      code: "rate_limited",
      requestId: "req_9",
    });
  });
});

describe("ToastProvider", () => {
  it("renders a pushed error toast with code, message, and an audit link", () => {
    render(
      <ToastProvider>
        <PushButton />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("trigger"));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load keys");
    expect(alert).toHaveTextContent("forbidden");
    expect(alert).toHaveTextContent("Access denied.");

    const link = screen.getByRole("link", { name: "View in audit log" });
    expect(link).toHaveAttribute("href", "/audit?request_id=req_123");
  });

  it("dismisses a toast when the close button is clicked", () => {
    render(
      <ToastProvider>
        <PushButton />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("trigger"));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
