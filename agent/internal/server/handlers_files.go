package server

import (
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
)

func (s *Server) handleFileList(w http.ResponseWriter, r *http.Request) {
	serverID := chi.URLParam(r, "serverID")
	if !isValidID(serverID) {
		jsonError(w, http.StatusBadRequest, "invalid server id")
		return
	}
	subPath := r.URL.Query().Get("path")

	entries, err := s.fileMgr.List(serverID, subPath)
	if err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, entries)
}

func (s *Server) handleFileRead(w http.ResponseWriter, r *http.Request) {
	serverID := chi.URLParam(r, "serverID")
	if !isValidID(serverID) {
		jsonError(w, http.StatusBadRequest, "invalid server id")
		return
	}
	filePath := extractFilePath(r)

	content, err := s.fileMgr.Read(serverID, filePath)
	if err != nil {
		jsonError(w, http.StatusNotFound, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Write(content)
}

func (s *Server) handleFileWrite(w http.ResponseWriter, r *http.Request) {
	serverID := chi.URLParam(r, "serverID")
	if !isValidID(serverID) {
		jsonError(w, http.StatusBadRequest, "invalid server id")
		return
	}
	filePath := extractFilePath(r)

	content, err := io.ReadAll(io.LimitReader(r.Body, 10<<20)) // 10MB limit
	if err != nil {
		jsonError(w, http.StatusBadRequest, "failed to read body")
		return
	}

	if err := s.fileMgr.Write(serverID, filePath, content); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]string{"status": "written"})
}

func (s *Server) handleFileDelete(w http.ResponseWriter, r *http.Request) {
	serverID := chi.URLParam(r, "serverID")
	if !isValidID(serverID) {
		jsonError(w, http.StatusBadRequest, "invalid server id")
		return
	}
	filePath := extractFilePath(r)

	if err := s.fileMgr.Delete(serverID, filePath); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func extractFilePath(r *http.Request) string {
	path := chi.URLParam(r, "*")
	return strings.TrimPrefix(path, "/")
}
