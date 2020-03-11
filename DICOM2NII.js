"use strict";
/* global require */

const args        = require( 'commander' ),
      async       = require( 'async' ),
      _           = require( 'lodash' ),
      desk        = require( 'desk-client' ),
      dicomParser = require( 'dicom-parser' ),
      filewalker  = require( 'filewalker' ),
      fs          = require( 'fs' ),
      path        = require( 'path' ),
      stats       = require( 'node-status' );

const cliArgs = process.argv.slice();

args.option( '-o, --orientation <string>', 'change output volumes orientation' )
	.requiredOption( '-d, --directory <path>', 'input directory' )
	.parse( cliArgs );

const concurrency = 1;
const dir = args.directory;
console.log( "Directory to visit : " + dir );
const nDICOMS = stats.addItem( 'DICOM' );
const nSeries = stats.addItem( 'series' );
const nDirs = stats.addItem( 'directories' );
stats.start( { interval: 1000 } );
let outputDir;
const seriesdIds = [];
const seriesTags = {};

const queue = async.queue( async function ( directory ) {

	try {

		let res = await desk.Actions.executeAsync( {

			action : 'getRelativePath',
			path : directory,
			stdout : true

		} );

		const dir = res.stdout;

		res = await desk.Actions.executeAsync( {

			action : 'c3d',
			inputDirectory : dir,
			command : '-dicom-series-list',
			stdout : true,
			force_update : true

		} );

		nDirs.inc();
		const series  = res.stdout.split( '\n' );
		series.shift();
		series.pop();
		nSeries.inc( series.length );

		const prom1 = getDICOMTags( series, directory );

		const prom2 = async.eachLimit( series, 2, async function ( serie ) {

			const values = serie.split( '\t' );
			const size = parseFloat ( values[ 2 ] );
			nDICOMS.inc( size );
			const seriesId = values[ 4 ];

			const opts = {

				action : 'c3d',
				inputDirectory : dir,
				command : '-dicom-series-read',
				option : seriesId,
				outputVolume : seriesId + ".nii.gz",
				outputDirectory : outputDir + "/" + seriesId,

			};

			if ( args.orientation ) opts.swapdim = args.orientation;

			try { await desk.Actions.executeAsync( opts );
				} catch ( e ) { return; }

			seriesdIds.push( seriesId );
		} );

		await Promise.all( [ prom1, prom2 ] );	

	} catch ( e ) {
		console.log( e );
	}

}, 3 );

async function getDICOMTags( series, directory ) {

	const files = _.shuffle( await fs.promises.readdir( directory ) );
	let nFound = 0;

	for ( let file of files ) {

		try {

			const content = await fs.promises.readFile( path.join( directory, file ) );
			const dataSet = dicomParser.parseDicom( content );
			const json = dicomParser.explicitDataSetToJS(dataSet);
			const id = json[ 'x0020000e'] + "."	+ json[ "x00200011" ]
				+ json[ "x00180050" ] + json[ "x00280010" ]
				+ json[ "x00280010" ];

			if ( !seriesTags[ id ] ) {

				seriesTags[ id ] = json;
				nFound++;
				if ( nFound == series.length ) return;

			}

		} catch( e ) {}

	}

}

desk.Actions.execute( {

    action : "getRootDir",
    stdout : true

}, async function ( err, res ){

    const rootDir = res.stdout;
    console.log( 'root dir : ' + rootDir);

	res = await desk.Actions.executeAsync( {

        action : "getRelativePath",
        stdout : true,
        path : process.cwd()

    } )

	outputDir = res.stdout;
	console.log( 'output dir : ' + outputDir);
	queue.push( dir + '/' );

	filewalker( dir )
		.on( 'dir', function ( file, stats ) {

			if ( file.includes( 'syngo_fV' ) ) return;
			queue.push( path.join( dir, file ) + '/' );

		} )
		.on( 'done', function () {

			queue.drain( function() {

				stats.stop();
				fs.writeFileSync( 'series.json', JSON.stringify( seriesdIds, null, "  " ) );
				fs.writeFileSync( 'tags.json', JSON.stringify( seriesTags, null, "  " ) );
				stats.stamp();
				process.exit(0);

			} );
		} )
		.walk();
	
});
