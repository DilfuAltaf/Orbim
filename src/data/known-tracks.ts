/**
 * Known Track Metadata Catalog.
 * Provides canonical titles, artist names, album names, duration, and artwork URLs
 * for catalog tracks to ensure artworks never render as empty.
 */

export interface KnownTrackMetadata {
  title: string
  artistName: string
  albumName?: string
  artworkUrl?: string
  durationSeconds?: number
}

export const KNOWN_TRACKS_MAP: Record<string, KnownTrackMetadata> = {
  "20jbSiX29FDX4oQxBXyUEi": {
    "title": "hate that i made you love me",
    "artistName": "Ariana Grande",
    "albumName": "hate that i made you love me",
    "artworkUrl": "https://i.scdn.co/image/ab67616d0000b273b622d42c30697e1e1414343c",
    "durationSeconds": 198
  },
  "2o1pb13quMReXZqE7jWsgq": {
    "title": "intro (end of the world)",
    "artistName": "Ariana Grande",
    "albumName": "eternal sunshine",
    "artworkUrl": "https://i.scdn.co/image/ab67616d0000b2738b58d20f1b77295730db15b4",
    "durationSeconds": 92
  },
  "7xoUc6faLbCqZO6fQEYprd": {
    "title": "One Last Time",
    "artistName": "Ariana Grande",
    "albumName": "My Everything (Deluxe)",
    "artworkUrl": "https://i.scdn.co/image/ab67616d0000b273deec12a28d1e336c5052e9aa",
    "durationSeconds": 197
  },
  "142PiXzA84lmEw2RstFHFa": {
    "title": "supernatural",
    "artistName": "Ariana Grande",
    "albumName": "eternal sunshine",
    "artworkUrl": "https://i.scdn.co/image/ab67616d0000b2738b58d20f1b77295730db15b4",
    "durationSeconds": 163
  },
  "1v1oIWf2Xgh54kIWuKsDf6": {
    "title": "Runaway",
    "artistName": "AURORA",
    "albumName": "All My Demons Greeting Me As A Friend (Deluxe)",
    "artworkUrl": "https://i.scdn.co/image/ab67616d0000b273c379325088c2845fe85cd70a",
    "durationSeconds": 249
  },
  "6dOtVTDdiauQNBQEDOtlAB": {
    "title": "BIRDS OF A FEATHER",
    "artistName": "Billie Eilish",
    "albumName": "HIT ME HARD AND SOFT",
    "artworkUrl": "https://i.scdn.co/image/ab67616d0000b27371d62ea7ea8a5be92d3c1f62",
    "durationSeconds": 210
  },
  "0UOG0zUn7t8m8QcxfzR7AH": {
    "title": "Merry Christmas, Please Don't Call",
    "artistName": "Bleachers",
    "albumName": "Merry Christmas, Please Don't Call",
    "artworkUrl": "https://i.scdn.co/image/ab67616d0000b2737fbed05d7226834da74c652b",
    "durationSeconds": 202
  },
  "2mdEsXPu8ZmkHRRtAdC09e": {
    "title": "Cinnamon Girl",
    "artistName": "Lana Del Rey",
    "albumName": "Norman Fucking Rockwell!",
    "artworkUrl": "https://i.scdn.co/image/ab67616d0000b273879e9318cb9f4e05ee552ac9",
    "durationSeconds": 301
  },
  "6IPwKM3fUUzlElbvKw2sKl": {
    "title": "we fell in love in october",
    "artistName": "girl in red",
    "albumName": "we fell in love in october / October Passed Me By",
    "artworkUrl": "https://i.scdn.co/image/ab67616d0000b273deade9f354749841f09feca2",
    "durationSeconds": 184
  },
  "76FZM38RC8XaAjJ77CVTNe": {
    "title": "Into You",
    "artistName": "Ariana Grande",
    "albumName": "Dangerous Woman",
    "artworkUrl": "https://i.scdn.co/image/ab67616d0000b27333342c57a9b2c4e04c97b3f5",
    "durationSeconds": 244
  },
  "3BJe4B8zGnqEdQPMvfVjuS": {
    "title": "Summertime Sadness",
    "artistName": "Lana Del Rey",
    "albumName": "Born To Die - The Paradise Edition",
    "artworkUrl": "https://i.scdn.co/image/ab67616d0000b273ebc8cfac8b586bc475b04918",
    "durationSeconds": 265
  },
  "0DuWDLjriRPjDRoPgaCslY": {
    "title": "Love In The Dark",
    "artistName": "Adele",
    "albumName": "25",
    "artworkUrl": "https://i.scdn.co/image/ab67616d0000b2737b9888dc365b8f957c63df14",
    "durationSeconds": 286
  },
  "0eAuGrXyGFYwur9ARUe7LJ": {
    "title": "Earrings",
    "artistName": "Malcolm Todd",
    "albumName": "Sweet Boy",
    "artworkUrl": "https://i.scdn.co/image/ab67616d0000b2732c1f34ecc1929fb59908aad1",
    "durationSeconds": 152
  },
  "21acb66djKRlDPJOXRBCkc": {
    "title": "Take A Chance With Me",
    "artistName": "NIKI",
    "albumName": "Nicole",
    "artworkUrl": "https://i.scdn.co/image/ab67616d0000b273d3997a4c208ac08dafff374f",
    "durationSeconds": 304
  },
  "1UPB5rYJ0bzn6mNSoAHrZC": {
    "title": "You'll Be in My Heart",
    "artistName": "NIKI",
    "albumName": "You'll Be In My Heart",
    "artworkUrl": "https://i.scdn.co/image/ab67616d0000b2737cd329ea4a204a8a47caf3d5",
    "durationSeconds": 242
  },
  "6HU7h9RYOaPRFeh0R3UeAr": {
    "title": "deja vu",
    "artistName": "Olivia Rodrigo",
    "albumName": "SOUR",
    "artworkUrl": "https://i.scdn.co/image/ab67616d0000b273a91c10fe9472d9bd89802e5a",
    "durationSeconds": 216
  },
  "5wANPM4fQCJwkGd4rN57mH": {
    "title": "drivers license",
    "artistName": "Olivia Rodrigo",
    "albumName": "SOUR",
    "artworkUrl": "https://i.scdn.co/image/ab67616d0000b273a91c10fe9472d9bd89802e5a",
    "durationSeconds": 242
  },
  "6gkbtMtioHgtyGjrMel6ei": {
    "title": "drop dead",
    "artistName": "Olivia Rodrigo",
    "albumName": "drop dead",
    "artworkUrl": "https://i.scdn.co/image/ab67616d0000b273c25b53f0a34aa1bb4f77cb3e",
    "durationSeconds": 225
  },
  "2tGvwE8GcFKwNdAXMnlbfl": {
    "title": "happier",
    "artistName": "Olivia Rodrigo",
    "albumName": "SOUR",
    "artworkUrl": "https://i.scdn.co/image/ab67616d0000b273a91c10fe9472d9bd89802e5a",
    "durationSeconds": 176
  },
  "5CZ40GBx1sQ9agT82CLQCT": {
    "title": "traitor",
    "artistName": "Olivia Rodrigo",
    "albumName": "SOUR",
    "artworkUrl": "https://i.scdn.co/image/ab67616d0000b273a91c10fe9472d9bd89802e5a",
    "durationSeconds": 229
  },
  "1UNEuG9DYOWiikf00ayr52": {
    "title": "Love Me Not",
    "artistName": "Ravyn Lenae",
    "albumName": "Love Me Not / Love Is Blind",
    "artworkUrl": "https://i.scdn.co/image/ab67616d0000b27333b05d358247bbe9971370f2",
    "durationSeconds": 213
  },
  "3rPtS4nfpy7PsARctAWpzd": {
    "title": "Best Friend",
    "artistName": "Rex Orange County",
    "albumName": "Best Friend",
    "artworkUrl": "https://i.scdn.co/image/ab67616d0000b273ff874602e13e9181c26e5f01",
    "durationSeconds": 262
  },
  "4cbiqQu0CPmSGggAItMrx0": {
    "title": "Hannah Montana",
    "artistName": "Rex Orange County",
    "albumName": "Hannah Montana",
    "artworkUrl": "https://i.scdn.co/image/ab67616d0000b273cb0fa34e128541cad15ae997",
    "durationSeconds": 213
  },
  "7aSyG7cskkG3zhfO2JLxq3": {
    "title": "Happiness",
    "artistName": "Rex Orange County",
    "albumName": "Apricot Princess",
    "artworkUrl": "https://i.scdn.co/image/ab67616d0000b2731bd6d088d3d81972af4cb81d",
    "durationSeconds": 280
  },
  "7ujApz6iFP3PmKIDGcaGbe": {
    "title": "Great Expectation",
    "artistName": "SIENNA SPIRO",
    "albumName": "Visitor",
    "artworkUrl": "https://i.scdn.co/image/ab67616d0000b273b09eea420767969b6729962b",
    "durationSeconds": 174
  },
  "7MXVkk9YMctZqd1Srtv4MB": {
    "title": "Starboy",
    "artistName": "The Weeknd, Daft Punk",
    "albumName": "Starboy",
    "artworkUrl": "https://i.scdn.co/image/ab67616d0000b2734718e2b124f79258be7bc452",
    "durationSeconds": 230
  },
  "0ug5NqcwcFR2xrfTkc7k8e": {
    "title": "Style",
    "artistName": "Taylor Swift",
    "albumName": "1989 (Deluxe)",
    "artworkUrl": "https://i.scdn.co/image/ab67616d0000b27352b2a3824413eefe9e33817a",
    "durationSeconds": 231
  },
  "4qW3BbQAwZsrnu8a3ZRdyT": {
    "title": "Self Aware",
    "artistName": "Temper City",
    "albumName": "Self Aware",
    "artworkUrl": "https://i.scdn.co/image/ab67616d0000b273d6c26d2ae723f7ab553d64cc",
    "durationSeconds": 181
  },
  "7CyPwkp0oE8Ro9Dd5CUDjW": {
    "title": "One Of The Girls (with JENNIE, Lily Rose Depp)",
    "artistName": "The Weeknd, JENNIE, Lily-Rose Depp",
    "albumName": "The Idol Episode 4 (Music from the HBO Original Series)",
    "artworkUrl": "https://i.scdn.co/image/ab67616d0000b273b0dd6a5cd1dec96c4119c262",
    "durationSeconds": 245
  },
  "0FIDCNYYjNvPVimz5icugS": {
    "title": "Timeless (feat Playboi Carti)",
    "artistName": "The Weeknd, Playboi Carti",
    "albumName": "Hurry Up Tomorrow",
    "artworkUrl": "https://i.scdn.co/image/ab67616d0000b273de79f330bc297af3fae736da",
    "durationSeconds": 256
  },
  "3zBdVzYsuqVPyMk1YFiPcg": {
    "title": "What If I Call",
    "artistName": "Alex Crichton",
    "albumName": "What If I Call",
    "artworkUrl": "https://i.scdn.co/image/ab67616d0000b27354eb62b85844cd19c533d245",
    "durationSeconds": 160
  },
  "2009X8GyWTqyxIdzAEYW6N": {
    "title": "The One That Got Away",
    "artistName": "Katy Perry",
    "albumName": "Teenage Dream",
    "artworkUrl": "https://i.scdn.co/image/ab67616d0000b2731d955011a3ed477dc77865ad",
    "durationSeconds": 227
  }
}

export function getKnownTrackMetadata(providerTrackId: string | null | undefined): KnownTrackMetadata | null {
  if (!providerTrackId) return null
  const clean = providerTrackId.replace(/^spotify:track:/i, '').trim()
  return KNOWN_TRACKS_MAP[clean] || null
}
