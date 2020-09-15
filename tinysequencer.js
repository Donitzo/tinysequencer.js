'use strict';

/*
 * data (unmangled) = {
 *     bpm: beats per minute,
 *     ppqn: pulses per quarter note,
 *     gaps: [silence before the first note, silence after the final release],
 *     tracks: [{
 *         wave: "sine" / "square" / "sawtooth" / "triangle" / "noise",
 *         mixer: [track volume (0-1), velocity volume attenuation (0-1), bass (100 Hz) gain dB, mid (1000 Hz) gain dB, treble (2500 Hz) gain dB],
 *         adsr: [attack duration in seconds, decay duration in seconds, sustain level (0-1), release duration in seconds],
 *         portamento: fraction of duration between notes to start frequency slide (0-1),
 *         cutoffDuration: duration in seconds,
 *         data: [
 *             note 0+n*0 - pulses since previous note
 *             note 0+n*1 - duration in pulses
 *             note 0+n*2 - MIDI number
 *             note 0+n*3 - velocity (0-127)
 *             note 1+n*0 - pulses since previous note
 *             ...
 *         ],
 * }
 */

class TinySequencer {
    constructor(ac, data, destNode) {
        // Cut curve at time t and interpolate a new point at the end (p = [time, value, ramp])
        function cutoff(curve, t) {
            const i = curve.findIndex(p => p[0] >= t);
            if (i >= 0) {
                const p1 = curve.splice(i)[0];
                if (i > 0) {
                    const p0 = curve[i - 1],
                        x = p1[2] ? Math.max(0, Math.min(1, (t - p0[0]) / (p1[0] - p0[0]))) : 0;
                    curve.push([t, p0[1] * (1 - x) + p1[1] * x, p1[2]]);
                }
            }
        }

        this.duration = 0;

        this.tracks = data['tracks'].map(track => {
            const gain = ac['createGain'](),
                pps = data['bpm'] * data['ppqn'] / 60,
                adsr = track['adsr'],
                mixer = track['mixer'],
                noteData = track['data'],
                noteCount = Math.floor((noteData.length + .5) / 4),
                notes = [],
                gCurve = [],
                fCurve = [];

            let prev = gain, time = data['gaps'][0];
            prev['gain']['value'] = mixer[0];

            // Create bass, mid and treble mixers
            [100, 1000, 2500].map((f, i) => {
                const filter = ac['createBiquadFilter']();
                filter['type'] = 'peaking';
                filter['frequency']['value'] = f;
                filter['gain']['value'] = mixer[i + 2];
                prev['connect'](prev = filter);
            });

            prev['connect'](destNode);

            // Process notes into curves
            for (let i = 0; i < noteCount; i++) {
                // Read note values
                time += noteData[i] / pps;
                const duration = noteData[i + noteCount] / pps,
                    midi = noteData[i + noteCount * 2],
                    volume = 1 - (1 - noteData[i + noteCount * 3] / 127) * mixer[1],
                    frequency = 2 ** ((midi - 69) / 12) * 440,
                    slide = i > 0 && track['portamento'] > 0;

                // Cutoff overlapping notes
                if (i > 0) {
                    cutoff(gCurve, time - Math.max(track['cutoffDuration'], 1e-6));
                    gCurve.push([Math.max(0, time - 1e-6 / 2), 0, true]);
                }

                // Create ADSR envelope
                if (adsr[0] > 0) {
                    gCurve.push([time, 0, false]);
                }
                if (adsr[1] > 0) {
                    gCurve.push([time + adsr[0], volume, adsr[0] > 0]);
                }
                gCurve.push([time + adsr[0] + adsr[1], adsr[2] * volume, adsr[0] + adsr[1] > 0]);
                gCurve.push([Infinity, adsr[2] * volume, false]);
                cutoff(gCurve, time + duration);
                gCurve.push([time + duration + adsr[3], 0, true]);

                // Create frequency envelope
                if (slide) {
                    const last = notes[notes.length - 1];
                    fCurve.push([time - (time - last.time) * track['portamento'], last.frequency, false]);
                }
                fCurve.push([time, frequency, slide]);

                this.duration = Math.max(this.duration, time + duration + adsr[3] + data['gaps'][1]);

                notes.push({ time, duration, midi, frequency, volume });
            }

            return { wave: track['wave'], gain, gCurve, fCurve, notes };
        });

        let startTime = null

        // Start sequencer
        this.play = (loop = false, volume = 1, time = null) => {
            this.stop();

            if (time === null) {
                time = ac['currentTime'];
            }

            startTime = time;

            this.tracks.map((track, t) => {
                let s;
                if (track.wave === 'noise') {
                    // Create noise source
                    const noise = ac['createBuffer'](1, ac['sampleRate'] * 2, ac['sampleRate']);
                    noise['getChannelData'](0).forEach((_, i, a) => a[i] = Math.random() * 2 - 1);

                    s = track.source = ac['createBufferSource']();
                    s['buffer'] = noise;
                    s['loop'] = true;
                } else {
                    // Create oscillator source
                    s = track.source = ac['createOscillator']();
                    s['type'] = track.wave;

                    // Apply frequency envelope
                    track.fCurve.forEach(p => p[2] ?
                        s['frequency']['linearRampToValueAtTime'](Math.max(1e-6, p[1]), time + p[0]) :
                        s['frequency']['setValueAtTime'](p[1], time + p[0]));
                }

                // Create ADSR envelope node
                track.adsr = ac['createGain']();
                track.adsr['gain']['value'] = 0;
                track.adsr['connect'](track.gain);

                // Apply ADSR envelope
                track.gCurve.forEach(p => p[2] ?
                    track.adsr['gain']['linearRampToValueAtTime'](Math.max(1e-6, p[1] * volume), time + p[0]) :
                    track.adsr['gain']['setValueAtTime'](p[1] * volume, time + p[0]));

                // Start audio source
                s['connect'](track.adsr);
                s['start'](time);

                // Handle stop and looping
                s['stop'](time + this.duration);
                if (t === 0) {
                    s['onended'] = () => {
                        this.stop();
                        if (loop) {
                            this.play(true, volume, time + this.duration);
                        }
                    };
                }
            });
        };

        // Stop sequencer
        this.stop = () => {
            if (startTime !== null) {
                startTime = null;
                this.tracks.map(track => {
                    track.source['onended'] = null;
                    track.source['stop']();
                    track.source['disconnect']();
                    track.adsr['disconnect']();
                });
            }
        }

        // Is the sequencer playing?
        this.isPlaying = () => startTime !== null;

        // Get the sequencer playing time
        this.currentTime = () => ac['currentTime'] - startTime;
    }
}
