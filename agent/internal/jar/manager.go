package jar

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/allaymc/agent/pkg/types"
)

var versionRegex = regexp.MustCompile(`^[a-zA-Z0-9._-]+$`)

type Manager struct {
	dataDir string
	client  *http.Client
}

func NewManager(dataDir string) *Manager {
	return &Manager{
		dataDir: dataDir,
		client:  &http.Client{Timeout: 120 * time.Second},
	}
}

func (m *Manager) GetVersions(serverType string) ([]types.JarVersion, error) {
	switch serverType {
	case "vanilla":
		return m.getVanillaVersions()
	case "paper":
		return m.getPaperVersions()
	default:
		return nil, fmt.Errorf("unknown server type: %s", serverType)
	}
}

func (m *Manager) Download(serverType, version string) error {
	if serverType != "vanilla" && serverType != "paper" {
		return fmt.Errorf("invalid server type: %s", serverType)
	}
	if !versionRegex.MatchString(version) {
		return fmt.Errorf("invalid version format: %s", version)
	}

	jarDir := filepath.Join(m.dataDir, "jars", serverType)
	os.MkdirAll(jarDir, 0755)
	jarPath := filepath.Join(jarDir, version+".jar")

	if _, err := os.Stat(jarPath); err == nil {
		return nil
	}

	var url string
	var err error

	switch serverType {
	case "vanilla":
		url, err = m.getVanillaDownloadURL(version)
	case "paper":
		url, err = m.getPaperDownloadURL(version)
	default:
		return fmt.Errorf("unknown server type: %s", serverType)
	}
	if err != nil {
		return err
	}

	return m.downloadFile(url, jarPath)
}

func (m *Manager) getVanillaVersions() ([]types.JarVersion, error) {
	resp, err := m.client.Get("https://launchermeta.mojang.com/mc/game/version_manifest_v2.json")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Mojang API returned HTTP %d", resp.StatusCode)
	}

	var manifest struct {
		Versions []struct {
			ID          string `json:"id"`
			Type        string `json:"type"`
			ReleaseTime string `json:"releaseTime"`
		} `json:"versions"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&manifest); err != nil {
		return nil, err
	}

	var versions []types.JarVersion
	for _, v := range manifest.Versions {
		if v.Type == "release" {
			versions = append(versions, types.JarVersion{
				ID:          v.ID,
				Type:        "vanilla",
				ReleaseTime: v.ReleaseTime,
			})
		}
	}

	return versions, nil
}

func (m *Manager) getVanillaDownloadURL(version string) (string, error) {
	resp, err := m.client.Get("https://launchermeta.mojang.com/mc/game/version_manifest_v2.json")
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("Mojang API returned HTTP %d", resp.StatusCode)
	}

	var manifest struct {
		Versions []struct {
			ID  string `json:"id"`
			URL string `json:"url"`
		} `json:"versions"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&manifest); err != nil {
		return "", err
	}

	var versionURL string
	for _, v := range manifest.Versions {
		if v.ID == version {
			versionURL = v.URL
			break
		}
	}
	if versionURL == "" {
		return "", fmt.Errorf("version %s not found", version)
	}

	resp2, err := m.client.Get(versionURL)
	if err != nil {
		return "", err
	}
	defer resp2.Body.Close()

	if resp2.StatusCode != http.StatusOK {
		return "", fmt.Errorf("Mojang version API returned HTTP %d", resp2.StatusCode)
	}

	var versionInfo struct {
		Downloads struct {
			Server struct {
				URL string `json:"url"`
			} `json:"server"`
		} `json:"downloads"`
	}
	if err := json.NewDecoder(resp2.Body).Decode(&versionInfo); err != nil {
		return "", err
	}

	return versionInfo.Downloads.Server.URL, nil
}

func (m *Manager) getPaperVersions() ([]types.JarVersion, error) {
	resp, err := m.client.Get("https://api.papermc.io/v2/projects/paper")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("PaperMC API returned HTTP %d", resp.StatusCode)
	}

	var project struct {
		Versions []string `json:"versions"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&project); err != nil {
		return nil, err
	}

	var versions []types.JarVersion
	for _, v := range project.Versions {
		versions = append(versions, types.JarVersion{
			ID:   v,
			Type: "paper",
		})
	}

	sort.Slice(versions, func(i, j int) bool {
		return compareSemanticVersions(versions[i].ID, versions[j].ID) > 0
	})

	return versions, nil
}

func (m *Manager) getPaperDownloadURL(version string) (string, error) {
	apiURL := fmt.Sprintf("https://api.papermc.io/v2/projects/paper/versions/%s/builds", url.PathEscape(version))
	resp, err := m.client.Get(apiURL)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("PaperMC builds API returned HTTP %d for version %s", resp.StatusCode, version)
	}

	var builds struct {
		Builds []struct {
			Build     int `json:"build"`
			Downloads struct {
				Application struct {
					Name string `json:"name"`
				} `json:"application"`
			} `json:"downloads"`
		} `json:"builds"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&builds); err != nil {
		return "", err
	}

	if len(builds.Builds) == 0 {
		return "", fmt.Errorf("no builds found for Paper %s", version)
	}

	latest := builds.Builds[len(builds.Builds)-1]
	downloadURL := fmt.Sprintf(
		"https://api.papermc.io/v2/projects/paper/versions/%s/builds/%d/downloads/%s",
		url.PathEscape(version), latest.Build, url.PathEscape(latest.Downloads.Application.Name),
	)

	return downloadURL, nil
}

func compareSemanticVersions(a, b string) int {
	aParts := strings.Split(a, ".")
	bParts := strings.Split(b, ".")

	maxLen := len(aParts)
	if len(bParts) > maxLen {
		maxLen = len(bParts)
	}

	for i := 0; i < maxLen; i++ {
		var aNum, bNum int
		if i < len(aParts) {
			aNum, _ = strconv.Atoi(aParts[i])
		}
		if i < len(bParts) {
			bNum, _ = strconv.Atoi(bParts[i])
		}
		if aNum != bNum {
			return aNum - bNum
		}
	}
	return 0
}

func (m *Manager) downloadFile(url, dest string) error {
	resp, err := m.client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed: HTTP %d", resp.StatusCode)
	}

	tmpPath := dest + ".tmp"
	f, err := os.Create(tmpPath)
	if err != nil {
		return err
	}

	_, err = io.Copy(f, resp.Body)
	f.Close()
	if err != nil {
		os.Remove(tmpPath)
		return err
	}

	return os.Rename(tmpPath, dest)
}
