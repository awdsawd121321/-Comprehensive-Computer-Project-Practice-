
// --- Logic: Map Initialization ---
useEffect(() => {
    if (activeScenario === 'nav') {
        mapService.init().then(success => {
            if (success) {
                setTimeout(() => {
                    const map = mapService.createMap('amap-container');
                    if (map) {
                        console.log('Map created');
                    }
                }, 500); // Wait for container to render
            }
        });
    }
}, [activeScenario]);
