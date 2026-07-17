defmodule AllayWeb.EndpointConfigTest do
  use ExUnit.Case, async: true

  alias AllayWeb.EndpointConfig

  describe "backend_host/1" do
    test "nil uses localhost" do
      assert EndpointConfig.backend_host(nil) == "localhost"
    end

    test "empty string → localhost with origin check disabled" do
      assert EndpointConfig.backend_host("") == "localhost"
    end

    test "https URL → host stripped, full origin allowed" do
      assert EndpointConfig.backend_host("https://api.allay.example") == "api.allay.example"
    end

    test "http URL with port → host without port, full origin allowed" do
      assert EndpointConfig.backend_host("http://10.0.0.5:8080") == "10.0.0.5"
    end

    test "scheme-less value → treated as the host verbatim" do
      # URI.parse("allay.local").host is nil, so the whole string becomes the host.
      assert EndpointConfig.backend_host("allay.local") == "allay.local"
    end
  end
end
