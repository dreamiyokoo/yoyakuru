import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import NotFound from "./not-found";

it("renders the not found page", () => {
  render(<NotFound />);
  expect(screen.getByRole("heading", { name: "ページが見つかりません" })).toBeInTheDocument();
});
