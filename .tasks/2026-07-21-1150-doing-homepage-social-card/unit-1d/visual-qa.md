# Unit 1d visual QA

## Surfaces

| Surface | Evidence | State |
| --- | --- | --- |
| Canonical social image | `spoonjoy-card-full-1200x630.png` | Final committed raster rendered at its native 1200x630 size |
| LinkedIn-style card image | `spoonjoy-card-linkedin-552x290.png` | Final committed raster resampled to a representative 552-pixel feed-card width |

## Inspection

The native card and the LinkedIn-size render preserve the same hierarchy: Spoonjoy branding, the primary editorial headline, supporting product language, and the real guest-homepage food photograph. The headline remains immediately readable at the smaller size, no copy is clipped or awkwardly wrapped, the split layout stays balanced, and the photo retains recognizable food detail. The image contains no invented interface, faux cookbook, or generated-looking illustration.

## Absurdity ledger

| Evidence | Viewport or state | Possible absurdity | Disposition |
| --- | --- | --- | --- |
| `spoonjoy-card-full-1200x630.png` | Native 1200x630 | The editorial whitespace between the headline and supporting-copy cluster is deliberate; the card otherwise has no clipping or unbalanced photo split. | intentionally accepted |
| `spoonjoy-card-linkedin-552x290.png` | Representative LinkedIn card width | Supporting copy and the photo badge are secondary at feed scale, while the headline and brand remain clear. This is the intended hierarchy rather than a readability failure. | intentionally accepted |

No `ready` or `needs reviewer gate` items remain.
