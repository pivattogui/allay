defmodule Allay.Servers.Files.PathSandboxTest do
  use ExUnit.Case, async: true

  alias Allay.Servers.Files.PathSandbox

  describe "sanitize/1" do
    test "strips null bytes" do
      assert PathSandbox.sanitize("a\0b/c") == "ab/c"
    end

    test "normalizes backslashes to forward slashes" do
      assert PathSandbox.sanitize("a\\b\\c") == "a/b/c"
    end

    test "strips leading slashes (absolute input becomes relative)" do
      assert PathSandbox.sanitize("/etc/passwd") == "etc/passwd"
      assert PathSandbox.sanitize("///foo") == "foo"
    end

    test "drops '.' segments" do
      assert PathSandbox.sanitize("a/./b/./c") == "a/b/c"
    end

    test "'..' pops one level" do
      assert PathSandbox.sanitize("a/../b") == "b"
      assert PathSandbox.sanitize("a/b/../c") == "a/c"
    end

    test "'..' at root silently no-ops" do
      assert PathSandbox.sanitize("..") == ""
      assert PathSandbox.sanitize("../../etc/passwd") == "etc/passwd"
    end

    test "traversal that climbs back inside resolves inside" do
      assert PathSandbox.sanitize("a/../../b") == "b"
    end

    test "backslash traversal is normalized then resolved" do
      assert PathSandbox.sanitize("..\\..\\x") == "x"
    end

    test "empty input is empty" do
      assert PathSandbox.sanitize("") == ""
    end

    test "collapses empty segments" do
      assert PathSandbox.sanitize("a//b") == "a/b"
    end
  end

  describe "resolve/2" do
    setup do
      dir = Path.join(System.tmp_dir!(), "sandbox_#{System.unique_integer([:positive])}")
      File.mkdir_p!(dir)
      on_exit(fn -> File.rm_rf(dir) end)
      {:ok, dir: dir}
    end

    test "resolves a relative path inside the server dir", %{dir: dir} do
      assert {:ok, full, rel} = PathSandbox.resolve(dir, "world/level.dat")
      assert full == Path.join(dir, "world/level.dat")
      assert rel == "world/level.dat"
    end

    test "empty relative resolves to the server dir itself", %{dir: dir} do
      assert {:ok, full, ""} = PathSandbox.resolve(dir, "")
      assert full == dir
    end

    test "traversal is contained inside the server dir", %{dir: dir} do
      assert {:ok, full, "etc/passwd"} = PathSandbox.resolve(dir, "../../etc/passwd")
      assert full == Path.join(dir, "etc/passwd")
    end

    test "rejects a non-existent server dir" do
      missing = Path.join(System.tmp_dir!(), "missing_#{System.unique_integer([:positive])}")
      assert {:error, :invalid_path} = PathSandbox.resolve(missing, "a")
    end

    test "prefix bug: a sibling sharing the dir-name prefix is not reachable", %{dir: dir} do
      # /x/srv must not leak into /x/srv2. A sibling whose name extends the
      # server dir name exists on disk; the within-check uses a trailing
      # separator, so even an input crafted to name the sibling re-roots under
      # the server dir (sanitize strips the leading "../") and stays contained.
      sibling = dir <> "2"
      File.mkdir_p!(sibling)
      File.write!(Path.join(sibling, "secret"), "x")
      on_exit(fn -> File.rm_rf(sibling) end)

      base2 = Path.basename(dir) <> "2"
      assert {:ok, full, rel} = PathSandbox.resolve(dir, "../#{base2}/secret")
      # Lands inside dir/<base2>/secret, never in the real sibling.
      assert full == Path.join([dir, base2, "secret"])
      assert rel == "#{base2}/secret"
      refute String.starts_with?(full, sibling <> "/")
      refute full == Path.join(sibling, "secret")
    end
  end

  describe "editable?/1" do
    test "true for editable extensions (case-insensitive)" do
      for ext <-
            ~w(.properties .yml .yaml .json .txt .cfg .conf .toml .xml .log .md .sk .sh .bat .cmd .csv .ini) do
        assert PathSandbox.editable?("file#{ext}"), "expected #{ext} editable"

        assert PathSandbox.editable?("FILE#{String.upcase(ext)}"),
               "expected #{ext} editable upcased"
      end
    end

    test "false for non-editable extensions" do
      assert PathSandbox.editable?("server.jar") == false
      assert PathSandbox.editable?("image.png") == false
      assert PathSandbox.editable?("noext") == false
    end

    test "legacy dead '.htaccess' is dropped (not editable)" do
      assert PathSandbox.editable?(".htaccess") == false
    end
  end

  describe "sensitive?/1" do
    test "true for sensitive basenames (case-insensitive)" do
      for name <-
            ~w(server.jar eula.txt banned-ips.json banned-players.json ops.json whitelist.json) do
        assert PathSandbox.sensitive?(name), "expected #{name} sensitive"
        assert PathSandbox.sensitive?(String.upcase(name)), "expected #{name} sensitive upcased"
      end
    end

    test "false for non-sensitive basenames" do
      assert PathSandbox.sensitive?("config.yml") == false
      assert PathSandbox.sensitive?("server.properties") == false
    end
  end

  describe "file_type/1" do
    test "config wins" do
      for ext <- ~w(.properties .yml .yaml .json .toml .xml .cfg .conf .ini) do
        assert PathSandbox.file_type("f#{ext}") == "config"
      end
    end

    test "image" do
      for ext <- ~w(.png .jpg .jpeg .gif .webp .bmp .ico) do
        assert PathSandbox.file_type("f#{ext}") == "image"
      end
    end

    test "archive" do
      for ext <- ~w(.zip .tar .gz .7z .rar) do
        assert PathSandbox.file_type("f#{ext}") == "archive"
      end
    end

    test "text" do
      for ext <- ~w(.txt .md .log .sh .bat .cmd .sk .csv) do
        assert PathSandbox.file_type("f#{ext}") == "text"
      end
    end

    test "binary fallback" do
      assert PathSandbox.file_type("server.jar") == "binary"
      assert PathSandbox.file_type("noext") == "binary"
    end

    test "case-insensitive" do
      assert PathSandbox.file_type("F.YML") == "config"
      assert PathSandbox.file_type("F.PNG") == "image"
    end
  end
end
