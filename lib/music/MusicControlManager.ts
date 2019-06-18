import {
    PlayerType,
    getRunningTrack,
    play,
    pause,
    previous,
    next,
    PlayerName,
    Track,
    setItunesLoved,
    launchPlayer,
    createPlaylist,
    addTracksToPlaylist,
    PlaylistItem,
    CodyResponse,
    CodyResponseType,
    PlayerDevice,
    getTrack,
    getSpotifyDevices
} from "cody-music";
import { workspace, window, ViewColumn } from "vscode";
import { MusicCommandManager } from "./MusicCommandManager";
import { showQuickPick } from "../MenuManager";
import {
    getUserStatus,
    serverIsAvailable,
    refetchSpotifyConnectStatusLazily,
    getLoggedInCacheState
} from "../DataController";
import { MusicStoreManager } from "./MusicStoreManager";
import {
    getItem,
    getMusicTimeFile,
    isLinux,
    logIt,
    buildLoginUrl,
    launchWebUrl
} from "../Util";
import {
    softwareGet,
    softwarePut,
    isResponseOk,
    softwarePost
} from "../HttpClient";
import {
    api_endpoint,
    LOGIN_LABEL,
    CODING_FAVORITES_NAME,
    SOFTWARE_TOP_SONGS_NAME
} from "../Constants";
import { MusicStateManager } from "./MusicStateManager";
const fs = require("fs");

const NO_DATA = "MUSIC TIME\n\nNo data available\n";

export class MusicControlManager {
    private msMgr: MusicStateManager = MusicStateManager.getInstance();

    constructor() {
        //
    }

    async getPlayer(): Promise<PlayerType> {
        const track = await getRunningTrack();
        if (track) {
            return track.playerType;
        }
        return null;
    }

    async next() {
        const playerType = await this.getPlayer();
        if (playerType) {
            if (playerType === PlayerType.WebSpotify) {
                await next(PlayerName.SpotifyWeb);
            } else if (playerType === PlayerType.MacItunesDesktop) {
                await next(PlayerName.ItunesDesktop);
            } else if (playerType === PlayerType.MacSpotifyDesktop) {
                await next(PlayerName.SpotifyDesktop);
            }
            MusicCommandManager.syncControls();
        }
    }

    async previous() {
        const playerType = await this.getPlayer();
        if (playerType) {
            if (playerType === PlayerType.WebSpotify) {
                await previous(PlayerName.SpotifyWeb);
            } else if (playerType === PlayerType.MacItunesDesktop) {
                await previous(PlayerName.ItunesDesktop);
            } else if (playerType === PlayerType.MacSpotifyDesktop) {
                await previous(PlayerName.SpotifyDesktop);
            }
            MusicCommandManager.syncControls();
        }
    }

    async play() {
        const playerType = await this.getPlayer();
        if (playerType) {
            if (playerType === PlayerType.WebSpotify) {
                await play(PlayerName.SpotifyWeb);
            } else if (playerType === PlayerType.MacItunesDesktop) {
                await play(PlayerName.ItunesDesktop);
            } else if (playerType === PlayerType.MacSpotifyDesktop) {
                await play(PlayerName.SpotifyDesktop);
            }
            MusicCommandManager.syncControls();
        }
    }

    async pause() {
        const playerType = await this.getPlayer();
        if (playerType) {
            if (playerType === PlayerType.WebSpotify) {
                await pause(PlayerName.SpotifyWeb);
            } else if (playerType === PlayerType.MacItunesDesktop) {
                await pause(PlayerName.ItunesDesktop);
            } else if (playerType === PlayerType.MacSpotifyDesktop) {
                await pause(PlayerName.SpotifyDesktop);
            }
            MusicCommandManager.syncControls();
        }
    }

    async setLiked(liked: boolean) {
        const track: Track = await getRunningTrack();
        if (track) {
            // set it to liked
            let trackId = track.id;
            if (trackId.indexOf(":") !== -1) {
                // strip it down to just the last id part
                trackId = trackId.substring(trackId.lastIndexOf(":") + 1);
            }
            let type = "spotify";
            if (track.playerType === PlayerType.MacItunesDesktop) {
                type = "itunes";
            }
            // use the name and artist as well since we have it
            let trackName = encodeURIComponent(track.name);
            let trackArtist = encodeURIComponent(track.artist);
            const api = `/music/liked/track/${trackId}/type/${type}?name=${trackName}&artist=${trackArtist}`;
            const payload = { liked };
            const resp = await softwarePut(api, payload, getItem("jwt"));
            if (isResponseOk(resp)) {
                if (type === "itunes") {
                    // await so that the stateCheckHandler fetches
                    // the latest version of the itunes track
                    await setItunesLoved(liked)
                        .then(result => {
                            console.log("updated itunes loved state");
                        })
                        .catch(err => {
                            console.log(
                                "unable to update itunes loved state, error: ",
                                err.message
                            );
                        });
                }
                // update the buttons
                this.msMgr.clearServerTrack();
                // update the buttons since the liked state changed
                MusicCommandManager.syncControls();
            }
        }
    }

    launchTrackPlayer(playerType: PlayerName = null) {
        if (!playerType) {
            getRunningTrack().then((track: Track) => {
                if (track && track.id) {
                    let options = {
                        trackId: track.id
                    };
                    let playerType: PlayerType = track.playerType;
                    let devices: PlayerDevice[] = MusicStoreManager.getInstance()
                        .spotifyPlayerDevices;

                    if (
                        playerType === PlayerType.WebSpotify &&
                        devices &&
                        devices.length === 1 &&
                        !devices[0].name.includes("Web Player")
                    ) {
                        // launch the spotify desktop
                        playerType = PlayerType.MacSpotifyDesktop;
                    }
                    if (playerType === PlayerType.WebSpotify) {
                        launchPlayer(PlayerName.SpotifyWeb, options);
                    } else if (playerType === PlayerType.MacItunesDesktop) {
                        launchPlayer(PlayerName.ItunesDesktop, options);
                    } else {
                        launchPlayer(PlayerName.SpotifyDesktop, options);
                    }
                }
            });
        } else {
            this.launchSpotifyPlayer();
        }
    }

    launchSpotifyPlayer() {
        window.showInformationMessage(
            `After you select and play your first song in Spotify, standard controls (play, pause, next, etc.) will appear in your status bar.`,
            ...["OK"]
        );
        setTimeout(() => {
            launchPlayer(PlayerName.SpotifyWeb);
        }, 3000);
    }

    async showMenu() {
        let loggedInCacheState = getLoggedInCacheState();
        let serverIsOnline = await serverIsAvailable();
        let userStatus = {
            loggedIn: loggedInCacheState
        };
        if (loggedInCacheState === null) {
            // update it since it's null
            // {loggedIn: true|false}
            userStatus = await getUserStatus(serverIsOnline);
        }
        let loginUrl = await buildLoginUrl();

        let loginMsgDetail =
            "To see your music data in Music Time, please log in to your account";
        if (!serverIsOnline) {
            loginMsgDetail =
                "Our service is temporarily unavailable. Please try again later.";
            loginUrl = null;
        }

        const spotifyDevices: PlayerDevice[] = await getSpotifyDevices();

        let menuOptions = {
            items: []
        };

        menuOptions.items.push({
            label: "Software Top 40",
            description: "",
            detail:
                "Top 40 most popular songs developers around the world listen to as they code",
            url: "https://api.software.com/music/top40",
            cb: null
        });

        menuOptions.items.push({
            label: "Music Time Dashboard",
            description: "",
            detail: "View your latest music metrics right here in your editor",
            url: null,
            cb: displayMusicTimeMetricsDashboard
        });

        if (!userStatus.loggedIn) {
            menuOptions.items.push({
                label: LOGIN_LABEL,
                description: "",
                detail: loginMsgDetail,
                url: loginUrl,
                cb: null
            });
        }

        // check if the user has the spotify_access_token
        const accessToken = getItem("spotify_access_token");
        if (!accessToken) {
            menuOptions.items.push({
                label: "Connect Spotify",
                description: "",
                detail:
                    "To see your Spotify playlists in Music Time, please connect your account",
                url: null,
                cb: connectSpotify
            });
        } else {
            // check if we already have a playlist
            const savedPlaylists: PlaylistItem[] = MusicStoreManager.getInstance()
                .savedPlaylists;
            const hasSavedPlaylists =
                savedPlaylists && savedPlaylists.length > 0 ? true : false;

            const codingFavs: any[] = MusicStoreManager.getInstance()
                .userFavorites;
            const hasUserFavorites =
                codingFavs && codingFavs.length > 0 ? true : false;

            if (!hasSavedPlaylists && hasUserFavorites) {
                // show the generate playlist menu item
                menuOptions.items.push({
                    label: "Create Coding Favorites Playlist",
                    description: "",
                    detail: `Create a Spotify playlist (${CODING_FAVORITES_NAME}) based on your weekly top 40`,
                    url: null,
                    cb: createCodingFavoritesPlaylist
                });
            }

            if (!spotifyDevices || spotifyDevices.length === 0) {
                menuOptions.items.push({
                    label: "Launch Spotify",
                    description: "",
                    detail:
                        "Launch the Spotify web player to view your playlist",
                    url: null,
                    cb: this.launchSpotifyPlayer
                });
            }
        }

        showQuickPick(menuOptions);
    }
}

export async function displayMusicTimeMetricsDashboard() {
    let musicTimeFile = getMusicTimeFile();
    await fetchMusicTimeMetricsDashboard();

    workspace.openTextDocument(musicTimeFile).then(doc => {
        // only focus if it's not already open
        window.showTextDocument(doc, ViewColumn.One, false).then(e => {
            // done
        });
    });
}

export async function createGlobalTopSongsPlaylist() {
    let musicstoreMgr = MusicStoreManager.getInstance();
    let globalFavs: any[] = musicstoreMgr.globalFavorites;
    if (globalFavs && globalFavs.length > 0) {
        // 1st create the empty playlist
        let playlistResult: CodyResponse = await createPlaylist(
            SOFTWARE_TOP_SONGS_NAME,
            true
        );

        // add the global songs to the playlist
        if (playlistResult.state === CodyResponseType.Failed) {
            window.showErrorMessage(
                `There was an unexpected error adding tracks to the playlist. ${
                    playlistResult.message
                }`,
                ...["OK"]
            );
            return;
        }

        if (playlistResult && playlistResult.data && playlistResult.data.id) {
            let result = await updateSavedPlaylists(
                playlistResult.data.id,
                2,
                SOFTWARE_TOP_SONGS_NAME
            );

            if (isResponseOk(result)) {
                console.log(`Synced playlist ID with music time`);
            }

            const globalFavs: any[] = musicstoreMgr.globalFavorites;
            if (globalFavs && globalFavs.length > 0) {
                let tracksToAdd: string[] = globalFavs.map(item => {
                    return item.uri;
                });
                await addTracks(
                    playlistResult.data.id,
                    2,
                    SOFTWARE_TOP_SONGS_NAME,
                    tracksToAdd
                );
            }
        }

        // refresh the playlists
        musicstoreMgr.refreshPlaylists();
    }
}

export async function createCodingFavoritesPlaylist() {
    let musicstoreMgr = MusicStoreManager.getInstance();
    // get the spotify track ids and create the playlist
    let codingFavs: any[] = musicstoreMgr.userFavorites;
    if (codingFavs && codingFavs.length > 0) {
        let playlistResult: CodyResponse = await createPlaylist(
            CODING_FAVORITES_NAME,
            true
        );

        if (playlistResult.state === CodyResponseType.Failed) {
            window.showErrorMessage(
                `There was an unexpected error adding tracks to the playlist. ${
                    playlistResult.message
                }`,
                ...["OK"]
            );
            return;
        }

        if (playlistResult && playlistResult.data && playlistResult.data.id) {
            let result = await updateSavedPlaylists(
                playlistResult.data.id,
                1,
                CODING_FAVORITES_NAME
            );

            // add the tracks
            // list of [{uri, artist, name}...]
            const codingFavs: any[] = musicstoreMgr.userFavorites;
            if (codingFavs && codingFavs.length > 0) {
                let tracksToAdd: string[] = codingFavs.map(item => {
                    return item.uri;
                });
                await addTracks(
                    playlistResult.data.id,
                    1,
                    CODING_FAVORITES_NAME,
                    tracksToAdd
                );
            }
        }

        // refresh the playlists
        musicstoreMgr.refreshPlaylists();
    }
}

async function updateSavedPlaylists(
    playlist_id: string,
    playlistTypeId: number,
    name: string
) {
    // i.e. playlistTypeId 1 = TOP_PRODUCIVITY_TRACKS
    // playlistTypeId 2 = SOFTWARE_TOP_SONGS_NAME
    const payload = {
        playlist_id,
        playlistTypeId,
        name
    };
    let createResult = await softwarePost(
        "/music/playlist",
        payload,
        getItem("jwt")
    );

    return createResult;
}

async function addTracks(
    playlist_id: string,
    playlistTypeId: number,
    name: string,
    tracksToAdd: string[]
) {
    if (playlist_id) {
        // create the playlist_id in software
        const addTracksResult: CodyResponse = await addTracksToPlaylist(
            playlist_id,
            tracksToAdd
        );

        if (addTracksResult.state === CodyResponseType.Success) {
            window.showInformationMessage(
                `Successfully created ${name} and added tracks.`,
                ...["OK"]
            );
        } else {
            window.showErrorMessage(
                `There was an unexpected error adding tracks to the playlist. ${
                    addTracksResult.message
                }`,
                ...["OK"]
            );
        }
    }
}

export async function connectSpotify() {
    const endpoint = `${api_endpoint}/auth/spotify?integrate=spotify&token=${getItem(
        "jwt"
    )}`;
    launchWebUrl(endpoint);
    refetchSpotifyConnectStatusLazily(20);
}

export async function fetchMusicTimeMetricsDashboard() {
    let musicTimeFile = getMusicTimeFile();

    const musicSummary = await softwareGet(
        `/dashboard?plugin=music-time&linux=${isLinux()}`,
        getItem("jwt")
    );

    // get the content
    let content =
        musicSummary && musicSummary.data ? musicSummary.data : NO_DATA;

    fs.writeFileSync(musicTimeFile, content, err => {
        if (err) {
            logIt(`Error writing to the Software session file: ${err.message}`);
        }
    });
}
