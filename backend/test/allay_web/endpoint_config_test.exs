defmodule AllayWeb.EndpointConfigTest do
  use ExUnit.Case, async: true

  alias AllayWeb.EndpointConfig

  describe "origin/1" do
    test "nil → localhost with origin check disabled" do
      assert EndpointConfig.origin(nil) == {"localhost", false}
    end

    test "empty string → localhost with origin check disabled" do
      assert EndpointConfig.origin("") == {"localhost", false}
    end

    test "https URL → host stripped, full origin allowed" do
      assert EndpointConfig.origin("https://allay.example") ==
               {"allay.example", ["https://allay.example"]}
    end

    test "http URL with port → host without port, full origin allowed" do
      assert EndpointConfig.origin("http://10.0.0.5:8080") ==
               {"10.0.0.5", ["http://10.0.0.5:8080"]}
    end

    test "scheme-less value → treated as the host verbatim" do
      # URI.parse("allay.local").host is nil, so the whole string becomes the host.
      assert EndpointConfig.origin("allay.local") == {"allay.local", ["allay.local"]}
    end
  end
end
