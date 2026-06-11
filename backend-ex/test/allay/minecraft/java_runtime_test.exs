defmodule Allay.Minecraft.JavaRuntimeTest do
  use ExUnit.Case, async: true

  alias Allay.Minecraft.JavaRuntime

  describe "parse_java_major/1" do
    test "parses modern and legacy version schemes" do
      cases = [
        {~s|openjdk version "21.0.11" 2026-01-01|, 21},
        {~s|openjdk version "25" 2026-03-01|, 25},
        {~s|openjdk version "25.0.1+9"|, 25},
        {~s|openjdk version "25-ea"|, 25},
        {~s|java version "1.8.0_402"|, 8},
        {~s|openjdk version "11.0.20"|, 11}
      ]

      for {output, expected} <- cases do
        assert JavaRuntime.parse_java_major(output) == expected, "for #{inspect(output)}"
      end
    end

    test "returns nil for unparseable output" do
      for garbage <- ["", "no version here", ~s|version "foo"|] do
        assert JavaRuntime.parse_java_major(garbage) == nil
      end
    end
  end

  describe "discover/1 with fake JDK trees" do
    setup do
      base = Path.join(System.tmp_dir!(), "jdks-#{System.unique_integer([:positive])}")
      on_exit(fn -> File.rm_rf!(base) end)
      %{base: base}
    end

    defp fake_jdk!(base, entry, banner_target, version) do
      bin = Path.join([base, entry, "bin"])
      File.mkdir_p!(bin)
      java = Path.join(bin, "java")

      script =
        case banner_target do
          :stderr -> "#!/bin/sh\necho 'openjdk version \"#{version}\"' >&2\n"
          :stdout -> "#!/bin/sh\necho 'openjdk version \"#{version}\"'\n"
        end

      File.write!(java, script)
      File.chmod!(java, 0o755)
    end

    test "discovers majors from stderr banners (the real java behavior)", %{base: base} do
      fake_jdk!(base, "temurin-21", :stderr, "21.0.11")
      fake_jdk!(base, "temurin-25", :stderr, "25")

      runtimes = JavaRuntime.discover([base])
      assert Map.keys(runtimes) |> Enum.sort() == [21, 25]
      assert runtimes[21] =~ "temurin-21/bin/java"
    end

    test "stdout banners also work", %{base: base} do
      fake_jdk!(base, "weird-jdk", :stdout, "17.0.2")
      assert %{17 => _} = JavaRuntime.discover([base])
    end

    test "first occurrence per major wins", %{base: base} do
      fake_jdk!(base, "a-first", :stderr, "21.0.1")
      fake_jdk!(base, "b-second", :stderr, "21.0.9")

      assert JavaRuntime.discover([base])[21] =~ "a-first"
    end

    test "ignores entries without an executable java and empty dirs", %{base: base} do
      File.mkdir_p!(Path.join(base, "not-a-jdk"))
      assert JavaRuntime.discover([base]) == %{}
      assert JavaRuntime.discover(["/nonexistent-dir"]) == %{}
    end
  end

  describe "find_compatible/2" do
    test "exact match wins" do
      assert JavaRuntime.find_compatible(%{21 => "/a", 25 => "/b"}, 21) == {21, "/a"}
    end

    test "falls forward to the smallest higher major" do
      assert JavaRuntime.find_compatible(%{21 => "/a", 25 => "/b"}, 17) == {21, "/a"}
      assert JavaRuntime.find_compatible(%{21 => "/a", 25 => "/b"}, 22) == {25, "/b"}
    end

    test "nil when nothing satisfies or map is empty" do
      assert JavaRuntime.find_compatible(%{21 => "/a"}, 26) == nil
      assert JavaRuntime.find_compatible(%{}, 8) == nil
    end
  end
end
