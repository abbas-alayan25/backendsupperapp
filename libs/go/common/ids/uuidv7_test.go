package ids

import "testing"

func TestNewProducesVersion7(t *testing.T) {
	id, err := New()
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if !IsV7(id.String()) {
		t.Fatalf("expected a version 7 UUID, got %s", id)
	}
}

func TestNewIsStrictlyIncreasing(t *testing.T) {
	previous, err := New()
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	for range 10000 {
		next, err := New()
		if err != nil {
			t.Fatalf("New: %v", err)
		}
		if next.String() <= previous.String() {
			t.Fatalf("%s is not after %s", next, previous)
		}
		previous = next
	}
}

func TestIsV7RejectsOtherValues(t *testing.T) {
	for _, value := range []string{"3b241101-e2bb-4255-8caf-4136c566a962", "not-a-uuid", ""} {
		if IsV7(value) {
			t.Fatalf("expected %q to be rejected", value)
		}
	}
}
