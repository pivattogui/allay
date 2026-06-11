defmodule Allay.Minecraft.VersionsTest do
  use ExUnit.Case, async: true

  alias Allay.Minecraft.Versions

  @manifest %{
    "versions" => [
      %{
        "id" => "26.1.2",
        "type" => "release",
        "releaseTime" => "2026-05-01T00:00:00Z",
        "url" => "https://piston-meta.example/26.1.2.json"
      },
      %{
        "id" => "26.2-rc1",
        "type" => "snapshot",
        "releaseTime" => "2026-05-10T00:00:00Z",
        "url" => "https://piston-meta.example/26.2-rc1.json"
      },
      %{
        "id" => "1.21.11",
        "type" => "release",
        "releaseTime" => "2025-11-01T00:00:00Z",
        "url" => "https://piston-meta.example/1.21.11.json"
      }
    ]
  }

  @meta_26_1_2 %{
    "javaVersion" => %{"majorVersion" => 25},
    "downloads" => %{
      "server" => %{"url" => "https://piston-data.example/server-26.1.2.jar", "sha1" => "abc123"}
    }
  }

  defp stub_routes(routes) do
    Req.Test.stub(Allay.Minecraft.APIStub, fn conn ->
      key = {conn.host, conn.request_path}

      case Map.fetch(routes, key) do
        {:ok, body} -> Req.Test.json(conn, body)
        :error -> Plug.Conn.send_resp(conn, 404, "not stubbed: #{inspect(key)}")
      end
    end)
  end

  describe "available_versions/1" do
    test "vanilla: releases only, max 20, manifest order" do
      stub_routes(%{
        {"launchermeta.mojang.com", "/mc/game/version_manifest.json"} => @manifest
      })

      assert {:ok, ["26.1.2", "1.21.11"]} = Versions.available_versions(:vanilla)
    end

    test "paper: reversed to newest-first, max 20" do
      stub_routes(%{
        {"api.papermc.io", "/v2/projects/paper"} => %{"versions" => ["1.20.1", "1.21.11"]}
      })

      assert {:ok, ["1.21.11", "1.20.1"]} = Versions.available_versions(:paper)
    end
  end

  describe "required_java_major/2" do
    test "vanilla reads javaVersion.majorVersion from version metadata" do
      stub_routes(%{
        {"launchermeta.mojang.com", "/mc/game/version_manifest.json"} => @manifest,
        {"piston-meta.example", "/26.1.2.json"} => @meta_26_1_2
      })

      assert {:ok, 25} = Versions.required_java_major(:vanilla, "26.1.2")
    end

    test "paper strips -rcN/-preN to find the vanilla manifest entry" do
      meta = %{"javaVersion" => %{"majorVersion" => 21}, "downloads" => %{}}

      stub_routes(%{
        {"launchermeta.mojang.com", "/mc/game/version_manifest.json"} => @manifest,
        {"piston-meta.example", "/1.21.11.json"} => meta
      })

      assert {:ok, 21} = Versions.required_java_major(:paper, "1.21.11-rc2")
    end

    test "unknown version errors mentioning the version" do
      stub_routes(%{
        {"launchermeta.mojang.com", "/mc/game/version_manifest.json"} => @manifest
      })

      assert {:error, message} = Versions.required_java_major(:vanilla, "9.9.9")
      assert message =~ "9.9.9"
    end

    test "metadata without javaVersion errors" do
      stub_routes(%{
        {"launchermeta.mojang.com", "/mc/game/version_manifest.json"} => @manifest,
        {"piston-meta.example", "/26.1.2.json"} => %{"downloads" => %{}}
      })

      assert {:error, message} = Versions.required_java_major(:vanilla, "26.1.2")
      assert message =~ "javaVersion"
    end
  end

  describe "download_spec/2" do
    test "vanilla carries url and sha1 from the version metadata" do
      stub_routes(%{
        {"launchermeta.mojang.com", "/mc/game/version_manifest.json"} => @manifest,
        {"piston-meta.example", "/26.1.2.json"} => @meta_26_1_2
      })

      assert {:ok, %{url: "https://piston-data.example/server-26.1.2.jar", sha1: "abc123"}} =
               Versions.download_spec(:vanilla, "26.1.2")
    end

    test "paper resolves the LAST build and assembles the download url" do
      stub_routes(%{
        {"api.papermc.io", "/v2/projects/paper/versions/1.21.11/builds"} => %{
          "builds" => [%{"build" => 10}, %{"build" => 42}]
        },
        {"api.papermc.io", "/v2/projects/paper/versions/1.21.11/builds/42"} => %{
          "downloads" => %{"application" => %{"name" => "paper-1.21.11-42.jar"}}
        }
      })

      assert {:ok, %{url: url, sha1: nil}} = Versions.download_spec(:paper, "1.21.11")

      assert url ==
               "https://api.papermc.io/v2/projects/paper/versions/1.21.11/builds/42/downloads/paper-1.21.11-42.jar"
    end

    test "paper with no builds errors" do
      stub_routes(%{
        {"api.papermc.io", "/v2/projects/paper/versions/0.0.0/builds"} => %{"builds" => []}
      })

      assert {:error, message} = Versions.download_spec(:paper, "0.0.0")
      assert message =~ "0.0.0"
    end
  end
end
