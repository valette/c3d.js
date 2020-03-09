"use strict";
/* global require */

const async       = require ( 'async' ),
      desk        = require ( 'desk-client' ),
      dicomParser = require ( 'dicom-parser' ),
      filewalker  = require ( 'filewalker' ),
      fs          = require ( 'fs' ),
      path        = require ( 'path' ),
      stats      = require ( 'node-status' );

const dir = process.argv[ 2 ] || process.cwd();
const concurrency = 1;

console.log( dir );
const useJS = false;

var nDICOMS = stats.addItem( 'DICOM' );
var nSeries = stats.addItem( 'series' );
var nDirs = stats.addItem( 'directories' );

stats.start( { interval: 1000 } );

const myConsole = stats.console();

var studies = { };
var patients = { };
var series = { };

var outputDir;
const seriesdIds = [];

const queue = async.queue( function ( dir, cb ) {

    desk.Actions.execute( {

        action : 'getRelativePath',
        path : dir,
        stdout : true

    }, function ( err, res ) {

        if ( err ) throw err;
        var dir = res.stdout;
        console.log(dir);
        desk.Actions.execute( {

            action : 'c3d',
            inputDirectory : dir,
            command : '-dicom-series-list',
            stdout : true,
            force_update : true

        }, function ( err, res ) {

            nDirs.inc();
            var series  = res.stdout.split( '\n' );
            series.shift();
            series.pop();
            nSeries.inc( series.length );
            async.eachLimit( series, 2, function ( serie, callback ) {

                console.log( "serie : " );
                console.log( serie );
                const values = serie.split( '\t' );
                const size = parseFloat ( values[ 2 ] );
                nDICOMS.inc( size );
                const seriesId = values[ 4 ];
                seriesdIds.push( seriesId );

                desk.Actions.execute( {

                    action : 'c3d',
                    inputDirectory : dir,
                    command : '-dicom-series-read',
                    option : seriesId,
                    outputVolume : seriesId + ".nii.gz",
                    outputDirectory : outputDir + "/" + seriesId,

                }, function( err, res ) {

                    if ( err ) console.log( err );
                    callback();

                } );

            }, cb );

        } );

    } );

}, 3 );

desk.Actions.execute( {

    action : "getRootDir",
    stdout : true

}, function ( err, res ){

    var rootDir = res.stdout;
    console.log( 'root dir : ' + rootDir);

    desk.Actions.execute( {

        action : "getRelativePath",
        stdout : true,
        path : process.cwd()

    }, function ( err, res ) {

        if ( err ) throw err;
        outputDir = res.stdout;
        console.log( 'output dir : ' + outputDir);

		queue.push( dir + '/' );
        filewalker( dir )
            .on( 'dir', function ( file, stats ) {
                if ( file.includes( 'syngo_fV' ) ) return;
        		queue.push( path.join( dir, file ) + '/' );
        
            } )
        	.on( 'done', function () {
                console.log("walking done");
        		queue.drain = function() {
        
        			stats.stop();
        			fs.writeFileSync( 'series.json', JSON.stringify( seriesdIds ) );
                    stats.stamp();
                    process.exit(0);
        
        		};
        
        	} )
        	.walk();

    } );
	
});
