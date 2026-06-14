defmodule AllayWeb.ErrorJSONTest do
  use AllayWeb.ConnCase, async: true

  test "renders 404 in the shared error contract" do
    assert AllayWeb.ErrorJSON.render("404.json", %{}) ==
             %{error: "Not Found", code: "NOT_FOUND"}
  end

  test "renders 500 in the shared error contract" do
    assert AllayWeb.ErrorJSON.render("500.json", %{}) ==
             %{error: "Internal Server Error", code: "INTERNAL_ERROR"}
  end

  test "renders other statuses generically" do
    assert AllayWeb.ErrorJSON.render("405.json", %{}) ==
             %{error: "Method Not Allowed", code: "METHOD_NOT_ALLOWED"}
  end
end
