package ids

import "github.com/google/uuid"

func New() (uuid.UUID, error) {
	return uuid.NewV7()
}

func IsV7(value string) bool {
	parsed, err := uuid.Parse(value)
	if err != nil {
		return false
	}
	return parsed.Version() == 7 && parsed.Variant() == uuid.RFC4122
}
