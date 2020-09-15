# tinysequencer.js
tinysequencer.js is a small music/sound effect sequencer made using the Web Audio API. It was created and used for [js13kgames](https://js13kgames.com/) 2020. tinysequencer.js was inspired by [TinyMusic](https://github.com/kevincennis/TinyMusic), a similiar sequencer. tinysequencer.js has additional support for ADSR envelopes and a compression-friendly data format.

### Requirements ###

tinysequencer.js is based on Javascript ES6 and will not work with older versions.

### Usage ###

```javascript
// Create a new AudioContext (and an optional compressor node for a more level sound)
const ac = new AudioContext();
const compressor = ac.createDynamicsCompressor();
compressor.connect(ac.destination);

// Create a sequence data structure
const data = { "bpm":120,"ppqn":96,"gaps":[0,0.1],"tracks":[{"data":[0,32,32,32,32, 16,16,16,16,16, 60,58,56,54,52, 127,127,127,127,127],"wave":"triangle","mixer":[0.1,0,1,1,1],
  "adsr":[0.001,0.1,0.3,0.5],"portamento":0.9,"cutoffDuration":0.01}]};

// Create an instance of TinySequencer
const sequencer = new TinySequencer(ac, data, compressor);

// Play the sequence
const loop = true;
sequencer.play(loop);

// Get the elapsed time of the current loop
setTimeout(() => console.log(sequencer.currentTime() + '/' + sequencer.duration), 2000);

// Is it playing?
console.log(sequencer.isPlaying());

// Stop the sequencer
setTimeout(sequencer.stop, 10000);
```

### Data format ###

The data format is a single unmangled Javascript object. The object can be parsed from JSON. The object has the following properties:

```
 data (unmangled) = {
     bpm: beats per minute,
     ppqn: pulses per quarter note,
     gaps: [silence before the first note, silence after the final release],
     tracks: [{
         wave: "sine" / "square" / "sawtooth" / "triangle" / "noise",
         mixer: [track volume (0-1), velocity volume attenuation (0-1), bass (100 Hz) gain dB, mid (1000 Hz) gain dB, treble (2500 Hz) gain dB],
         adsr: [attack duration in seconds, decay duration in seconds, sustain level (0-1), release duration in seconds],
         portamento: fraction of duration between notes to start frequency slide (0-1),
         cutoffDuration: duration in seconds,
         data: [
             note 0+n*0 - pulses since previous note
             note 0+n*1 - duration in pulses
             note 0+n*2 - MIDI number
             note 0+n*3 - velocity (0-127)
             note 1+n*0 - pulses since previous note
             ...
         ],
 }
```
For optimal compression, note properties are aligned by type, not by note index:
1. The first 1/4 of track.data contains pulses since previous note.
2. The second 1/4 of track.data contains the note duration in pulses.
3. The third 1/4 of the track.data contains the MIDI number.
4. The final 1/4 of the track.data contains note velocity (optionally used for attenuation).

### Google Closure compiler compatibility ###

tinysequencer.js was successfully mangled using the Google Closure Compiler with ADVANCED_OPTIMIZATIONS and ECMASCRIPT_2017. All external properties have been quoted and should be left alone by the compiler.

### Editor ###

An extremely basic MIDI converter (track-data only, no instruments) is available if there is a desire. Leave an issue.
