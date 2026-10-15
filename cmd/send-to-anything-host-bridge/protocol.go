package main

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
)

// MaxMessageSize is Chromium's limit for native messaging (1MB).
const MaxMessageSize = 1024 * 1024

// Request represents a message sent from the Chromium extension.
type Request struct {
	Command        string   `json:"command"`
	Args           []string `json:"args,omitempty"`
	InputMode      string   `json:"input_mode,omitempty"` // "stdin", "arg", "both"
	Text           string   `json:"text,omitempty"`
	Prompt         string   `json:"prompt,omitempty"`
	TimeoutSeconds int      `json:"timeout_seconds,omitempty"`
	FireAndForget  bool     `json:"fire_and_forget,omitempty"`
}

// Response represents the message returned to the Chromium extension.
type Response struct {
	Output   string `json:"output"`
	Error    string `json:"error,omitempty"`
	ExitCode int    `json:"exit_code"`
}

// ReadMessage reads a 32-bit LE length-prefixed JSON message from the reader.
func ReadMessage(r io.Reader) (*Request, error) {
	var length uint32
	if err := binary.Read(r, binary.LittleEndian, &length); err != nil {
		return nil, err
	}

	if length > MaxMessageSize {
		return nil, fmt.Errorf("message size %d exceeds max allowed size (%d bytes)", length, MaxMessageSize)
	}

	payload := make([]byte, length)
	if _, err := io.ReadFull(r, payload); err != nil {
		return nil, fmt.Errorf("failed to read message body: %w", err)
	}

	var req Request
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, fmt.Errorf("invalid json payload: %w", err)
	}

	return &req, nil
}

// WriteMessage writes a 32-bit LE length-prefixed JSON response to the writer.
func WriteMessage(w io.Writer, resp *Response) error {
	data, err := json.Marshal(resp)
	if err != nil {
		return fmt.Errorf("failed to marshal response: %w", err)
	}

	if len(data) > MaxMessageSize {
		return fmt.Errorf("response size %d exceeds max allowed size (%d bytes)", len(data), MaxMessageSize)
	}

	length := uint32(len(data))
	if err := binary.Write(w, binary.LittleEndian, length); err != nil {
		return fmt.Errorf("failed to write message length: %w", err)
	}

	if _, err := w.Write(data); err != nil {
		return fmt.Errorf("failed to write message body: %w", err)
	}

	return nil
}
