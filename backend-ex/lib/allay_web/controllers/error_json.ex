defmodule AllayWeb.ErrorJSON do
  @moduledoc """
  Renders errors that bypass FallbackController (router 404s, crashes)
  in the same `{error, code}` contract the rest of the API uses.
  """

  # The generic path would produce INTERNAL_SERVER_ERROR; the legacy TS
  # backend emits INTERNAL_ERROR for 500s (backend/src/app.ts onError),
  # and parity with it is the contract.
  def render("500.json", _assigns) do
    %{error: "Internal Server Error", code: "INTERNAL_ERROR"}
  end

  def render(template, _assigns) do
    message = Phoenix.Controller.status_message_from_template(template)

    %{
      error: message,
      code: message |> String.upcase() |> String.replace(" ", "_")
    }
  end
end
